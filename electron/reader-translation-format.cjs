'use strict';
// Pure text boundary shared by the preview API and its generated cache reader.
// Existing successful prose remains unchanged; recognized transport wrappers
// are unwrapped, never shown or cached as the translation itself.
function normalizeTranslation(output, source = '') {
  if(typeof output!=='string' || !output.trim() || output.length>20000)return null;
  let text=output.trim();
  const fenced=text.match(/^```(?:json|text)?\s*\n([\s\S]*?)\n```$/i);
  if(fenced)text=fenced[1].trim();
  // A document that intentionally contains JSON must retain that content.
  if(/^[{[]/.test(source.trim()))return text;
  if(/^[{[]/.test(text)) {
    let value;
    try { value=JSON.parse(text); } catch { return null; }
    if(!value || Array.isArray(value) || typeof value!=='object')return null;
    const keys=Object.keys(value);
    // `source` is a legacy one-field title wrapper emitted by older GPT runs.
    // Keep it readable for cached titles, while still rejecting mixed or malformed objects.
    if(keys.length!==1 || !['source','translation','translationZh'].includes(keys[0]) ||
       typeof value[keys[0]]!=='string' || !value[keys[0]].trim())return null;
    text=value[keys[0]].trim();
  }
  return text || null;
}
module.exports={normalizeTranslation};
