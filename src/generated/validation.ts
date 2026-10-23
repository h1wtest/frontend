// Shared strict interpreter for the generator's closed JSON Schema subset.
type Rule = {type?:string|readonly string[];$ref?:string;anyOf?:readonly Rule[];properties?:Readonly<Record<string,Rule>>;required?:readonly string[];items?:Rule;enum?:readonly unknown[];const?:unknown;format?:string;minLength?:number;maxLength?:number;minimum?:number|bigint;maximum?:number|bigint;minItems?:number;maxItems?:number};
type Schema={readonly $defs:Readonly<Record<string,Rule>>};
export function format(kind:string,text:string):boolean {
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
 switch(kind){
 case '':return true;
 case 'uuid':return uuid.test(text);
 case 'uuid-v7':return uuid.test(text)&&text[14]==='7';
 case 'sha256':return /^[0-9a-f]{64}$/.test(text);
 case 'date-time':return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(text)&&Number.isFinite(Date.parse(text));
 case 'decimal':return /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text);
 case 'usdt6':return /^(0|[1-9][0-9]{0,6})\.[0-9]{6}$/.test(text)&&BigInt(text.replace('.',''))<=9000000000000n;
 case 'usdt6-total':return /^(0|[1-9][0-9]{0,12})\.[0-9]{6}$/.test(text)&&BigInt(text.replace('.',''))<=9223372036854775807n;
 case 'traceparent':return /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(text)&&text.slice(3,35)!=='0'.repeat(32)&&text.slice(36,52)!=='0'.repeat(16);
 case 'encrypted':try{return /^[A-Za-z0-9+/]+={0,2}$/.test(text)&&text.length%4===0&&atob(text).length>=28;}catch{return false;}
 default:return false;
 }
}
export function validate(schema:Schema,name:string,value:unknown):void {check(schema,schema.$defs[name],value);}
function check(schema:Schema,rule:Rule|undefined,value:unknown):void {
 const fail=(why:string):never=>{throw new TypeError('Invalid contract: '+why);};
 if(!rule)return fail('unknown definition');
 if(rule.$ref)return check(schema,schema.$defs[rule.$ref.slice('#/$defs/'.length)],value);
 if(rule.anyOf){for(const choice of rule.anyOf){try{check(schema,choice,value);return;}catch{/* Try next supported branch. */}}return fail('nullable reference');}
 const allowed=(kind:string)=>typeof rule.type==='string'?rule.type===kind:rule.type?.includes(kind);
 if(value===null){if(allowed('null')&&(!rule.enum||rule.enum.includes(null)))return;return fail('null');}
 if('const'in rule&&value!==rule.const)return fail('constant');
 if(rule.enum&&!rule.enum.includes(value))return fail('enum');
 if(Array.isArray(value)){if(!allowed('array'))return fail('array');if(rule.minItems!==undefined&&value.length<rule.minItems||rule.maxItems!==undefined&&value.length>rule.maxItems)return fail('array length');for(const item of value)check(schema,rule.items,item);return;}
 if(typeof value==='object'){
  if(!allowed('object'))return fail('object');const fields=value as Record<string,unknown>;
  for(const key of rule.required??[])if(!Object.prototype.hasOwnProperty.call(fields,key))return fail('missing '+key);
  for(const [key,item]of Object.entries(fields)){if(!rule.properties||!Object.prototype.hasOwnProperty.call(rule.properties,key))return fail('unknown '+key);check(schema,rule.properties[key],item);}return;
 }
 if(typeof value==='string'){if(!allowed('string'))return fail('string');const length=[...value].length;if(rule.minLength!==undefined&&length<rule.minLength||rule.maxLength!==undefined&&length>rule.maxLength||!format(rule.format??'',value))return fail('string constraint');return;}
 if(typeof value==='boolean'){if(!allowed('boolean'))return fail('boolean');return;}
 if(typeof value==='number'||typeof value==='bigint'){
  if(!allowed('integer')||typeof value==='number'&&!Number.isSafeInteger(value))return fail('integer');
  // BigInt is admitted only by explicitly wide integer schemas, never public versions.
  if(typeof value==='bigint'&&typeof rule.maximum!=='bigint'&&typeof rule.minimum!=='bigint')return fail('safe public integer required');
  const integer=BigInt(value);
  if(rule.minimum!==undefined&&integer<BigInt(rule.minimum)||rule.maximum!==undefined&&integer>BigInt(rule.maximum))return fail('integer bounds');return;
 }
 return fail('value');
}
// Parse tokens before JSON.parse can round an integer or collapse duplicate keys.
export function parseStrictJSON(text:string):unknown {
 if(text.length>1048576)throw new TypeError('Contract body too large');let at=0;
 const ws=()=>{while(at<text.length&&/[ \t\r\n]/.test(text[at]))at++;};
 const string=():string=>{const start=at++;while(at<text.length){if(text[at]==='\\'){at+=2;continue;}if(text[at++]==='"')return JSON.parse(text.slice(start,at)) as string;}throw new SyntaxError('Unclosed string');};
 const value=(depth:number):unknown=>{
  if(depth>128)throw new SyntaxError('JSON nesting too deep');ws();
  if(text[at]==='"')return string();
  if(text[at]==='{'){
   at++;const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;ws();if(text[at]==='}'){at++;return out;}
   while(true){ws();if(text[at]!=='"')throw new SyntaxError('Key required');const key=string();if(Object.prototype.hasOwnProperty.call(out,key))throw new SyntaxError('Duplicate JSON key');ws();if(text[at++]!==':')throw new SyntaxError('Colon required');out[key]=value(depth+1);ws();const delimiter=text[at++];if(delimiter==='}')return out;if(delimiter!==',')throw new SyntaxError('Comma required');}
  }
  if(text[at]==='['){at++;const out:unknown[]=[];ws();if(text[at]===']'){at++;return out;}while(true){out.push(value(depth+1));ws();const delimiter=text[at++];if(delimiter===']')return out;if(delimiter!==',')throw new SyntaxError('Comma required');}}
  const start=at;while(at<text.length&&!/[ \t\r\n,}\]]/.test(text[at]))at++;if(start===at)throw new SyntaxError('Value required');const token=text.slice(start,at);
  if(/^-?(0|[1-9][0-9]*)$/.test(token)){const integer=BigInt(token);return integer>BigInt(Number.MAX_SAFE_INTEGER)||integer<BigInt(Number.MIN_SAFE_INTEGER)?integer:Number(token);}
  return JSON.parse(token) as unknown;
 };
 const result=value(0);ws();if(at!==text.length)throw new SyntaxError('Trailing JSON');return result;
}
// Event-only serializer emits exact integer tokens, not quoted BigInt strings.
export function stringifyStrictJSON(value:unknown):string {
 const seen=new Set<object>();
 const encode=(item:unknown,depth:number):string=>{
  if(depth>128)throw new TypeError('JSON nesting too deep');
  if(item===null||typeof item==='boolean'||typeof item==='string')return JSON.stringify(item);
  if(typeof item==='bigint')return item.toString();
  if(typeof item==='number'){if(!Number.isSafeInteger(item))throw new TypeError('Exact integer required');return String(item);}
  if(typeof item!=='object')throw new TypeError('Unsupported JSON value');
  if(seen.has(item))throw new TypeError('Cyclic JSON');seen.add(item);
  try {if(Array.isArray(item))return '['+item.map(v=>encode(v,depth+1)).join(',')+']';const prototype=Object.getPrototypeOf(item);if(prototype!==null&&prototype!==Object.prototype)throw new TypeError('Plain JSON object required');return '{'+Object.entries(item).filter(([,v])=>v!==undefined).map(([k,v])=>JSON.stringify(k)+':'+encode(v,depth+1)).join(',')+'}';}finally{seen.delete(item);}
 };
 const text=encode(value,0);if(text.length>1048576)throw new TypeError('Contract body too large');return text;
}
