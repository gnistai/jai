// Plain-language messages for JAI diagnostic codes (informative; the codes are
// what the specification defines). {key} is replaced with the key concerned.
// CC0-1.0.
export const CLASS = {
  parser: ['empty-segment', 'empty-value', 'reserved-key', 'invalid-key', 'missing-marker', 'unsupported-version', 'invalid-marker', 'number-value', 'duplicate-member', 'duplicate-key', 'unsupported-member', 'invalid-json', 'malformed-container', 'undecodable'],
  interpreter: ['repeated-single', 'invalid-value', 'adjusted-value', 'ignored-value', 'invalid-image', 'unsupported-preview', 'no-matching-model', 'substituted-model', 'version-ignored'],
};
export const classOf = code => (CLASS.parser.includes(code) ? 'parser' : CLASS.interpreter.includes(code) ? 'interpreter' : 'validator');

export const MESSAGES = {
  'empty-segment': ['An extra semicolon left an empty part, which was ignored.', 'Remove the doubled ";".'],
  'empty-value': ['The setting "{key}" has no value, so it was dropped.', 'Write a value after "=", or remove the setting.'],
  'reserved-key': ['"jai" cannot be used as a setting name; that part was dropped.', 'Choose another name, or put the text in the description.'],
  'invalid-key': ['A JSON member name is not a valid JAI key and was dropped.', 'Use lowercase letters, digits, "_", "-" and "." only.'],
  'missing-marker': ['The JSON has no "jai": 1 member.', 'Add "jai": 1 so the object is recognisable as JAI.'],
  'unsupported-version': ['The "jai" marker is not 1. Viewers will not render this automatically.', 'Use "jai": 1.'],
  'invalid-marker': ['The "jai" marker is not the number 1.', 'Use "jai": 1, without quotes.'],
  'number-value': ['A JSON number or true/false for "{key}" was turned into text.', 'Write values as JSON strings.'],
  'duplicate-member': ['A JSON member appears twice.', 'Keep one.'],
  'duplicate-key': ['"{key}" appears with different capitalisation; the values were combined.', 'Use one lowercase spelling.'],
  'unsupported-member': ['A nested object or list under "{key}" was ignored.', 'Values must be strings or lists of strings.'],
  'invalid-json': ['This looks like JSON but is not valid JSON, so nothing was read.', 'Check quotes, commas and brackets.'],
  'malformed-container': ['The gzip container is damaged or does not contain JAI JSON.', 'Re-export the .jai file.'],
  'undecodable': ['These bytes are not UTF-8 text.', 'Save the file as UTF-8.'],
  'first-segment-assignment': ['The text starts with "{key}=", so it was read as a setting and there is no description.', 'Start with "prompt=" or write "\\=" to keep the "=" in the description.'],
  'invalid-qualifier': ['"{key}" names a model, but only prompt, style and avoid can be refined per model.', 'Drop the "/…" part, or write "\\=" if this was meant as text.'],
  'alt-repeated': ['data-jai repeats the alt text, so the model receives it twice.', 'The alt text is already the first line of the description: keep only extra detail and settings in data-jai.'],
  'unknown-key': ['"{key}" is not a standard setting. Undotted names are reserved.', 'Put it in the description, use a standard setting, or a vendor name like "acme.{key}".'],
  'continuation-into-single-valued-key': ['Text after "{key}=" was added to that setting.', 'Move the text into the description, or start it with ";prompt=".'],
  'no-prompt': ['There is no description.', 'Write the description first.'],
  'bare-key': ['"{key}" on its own is description text, not a setting.', 'Write "{key}=true".'],
  'newline-assignment': ['A line inside "{key}" looks like a setting, but a new line does not start one.', 'End the previous line with ";".'],
  'prefix-in-prompt': ['The description still starts with "jai:".', 'Remove the extra prefix.'],
  'stray-wrapper': ['The whole document is wrapped in quotes or a code fence.', 'Remove the wrapper.'],
  'split-data-uri': ['A semicolon inside the data: URL of "{key}" split it.', 'Write "\\;" before charset= or name=, or use base64 without parameters.'],
  'url-split': ['A URL value was split at a semicolon.', 'Escape the semicolon with "\\;".'],
  'confusable-delimiter': ['A full-width or Arabic semicolon looks like a separator but is text.', 'Use the ASCII ";" and "=".'],
  'confusable-equals': ['A full-width equals sign looks like "=" but is text.', 'Use the ASCII "=".'],
  'foreign-syntax': ['This looks like another prompt dialect (Midjourney or Stable Diffusion flags).', 'Translate: --ar 16:9 becomes ;aspect=16:9, --no text becomes ;avoid=text.'],
  'colon-assignment': ['"{key}: value" was probably meant as a setting.', 'Write ";{key}=value".'],
  'quoted-value': ['The value of "{key}" is in quotes.', 'Remove the quotes.'],
  'percent-encoded-text': ['"{key}" contains %XX sequences, which are not decoded here.', 'Write the characters themselves.'],
  'control-character': ['"{key}" contains an invisible control character.', 'Remove it.'],
  'invisible-char': ['"{key}" contains an invisible formatting character.', 'Remove it.'],
  'bidi-control': ['"{key}" contains a text-direction override character.', 'Remove it.'],
  'nonstandard-value': ['"{key}" is valid but usually written differently.', 'Prefer the canonical spelling.'],
  'invalid-value': ['The value of "{key}" is not understood and will be ignored.', 'See the allowed values for "{key}".'],
  'negated-avoid': ['An avoid value starts with "no" or "not", which can make models add the thing.', 'Name the thing itself: avoid=text, not avoid=no text.'],
  'strength-without-transform': ['"strength" only has an effect with mode=transform.', 'Add ;mode=transform or remove strength.'],
  'repeated-single': ['"{key}" is given more than once; the last value is used.', 'Keep one.'],
  'model-looks-like-locator': ['A model value looks like a URL or path. It is a name, never downloaded.', 'Use a model name such as flux or sdxl.'],
  'large-payload': ['"{key}" is very long.', 'Shorten it or move binary data to a URL.'],
  'non-canonical-encoding': ['A .jai file should be gzip-compressed JSON.', 'Use "Download .jai" to get the canonical file.'],
  'unencoded-url-text': ['A URL contains spaces, "#" or "%" that are not encoded.', 'Use the canonical data: URL below.'],
  'missing-size': ['An image whose src is JAI needs width and height.', 'Add width and height attributes.'],
  'adjusted-value': ['"{key}" was adjusted to the allowed range.', ''],
  'ignored-value': ['"{key}" has no effect here.', ''],
  'invalid-image': ['"{key}" must be a PNG, JPEG, WebP, GIF or AVIF image.', ''],
  'unsupported-preview': ['"preview" must be a small raster data: URL; it is never fetched from the network.', ''],
  'no-matching-model': ['No configured renderer matches the model preferences; the default is used.', ''],
  'substituted-model': ['A model of the same family was chosen.', ''],
  'version-ignored': ['The model version suffix was ignored.', ''],
};

export function describe(d) {
  const [msg, fix] = MESSAGES[d.code] || [d.code, ''];
  const sub = s => s.replaceAll('{key}', d.key ?? 'value');
  return { message: sub(msg), fix: sub(fix) };
}
