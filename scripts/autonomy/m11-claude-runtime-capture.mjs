const CAPTURE_SCHEMA_VERSION = 1;
const CAPTURE_VERSION = 'm11-claude-runtime-capture@v1';
const SUPPORTED_PARSER_CONTRACT_VERSION = CAPTURE_VERSION;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 4096;
const MAX_DEPTH = 24;
const MAX_ID_BYTES = 200;
const MAX_MODEL_BYTES = 160;
const MAX_SUBTYPE_BYTES = 64;

const ALLOWED_RESULT_SUBTYPES = new Set([
  'success',
  'error_max_turns',
  'error_max_budget_usd',
  'error_during_execution',
  'error_max_structured_output_retries'
]);

class ParseError extends Error {}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isSafeText(value, maxBytes) {
  return typeof value === 'string'
    && value.length > 0
    && value.isWellFormed()
    && Buffer.byteLength(value, 'utf8') <= maxBytes;
}

function isSafeOptionalText(value, maxBytes) {
  return value === undefined || value === null || isSafeText(value, maxBytes);
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function safeParserVersion(input) {
  return isSafeText(input, MAX_MODEL_BYTES) ? input : null;
}

function ownString(value, key, maxBytes) {
  if (!hasOwn(value, key)) return {present: false, value: null};
  const item = value[key];
  if (!isSafeText(item, maxBytes)) return {present: true, invalid: true, value: null};
  return {present: true, invalid: false, value: item};
}

function collectModelFromModelUsage(record, models) {
  if (!hasOwn(record, 'modelUsage')) return null;
  const usage = record.modelUsage;
  if (!isRecord(usage)) return 'RESULT_MODEL_USAGE_INVALID';
  const keys = Object.keys(usage);
  if (keys.length === 0 || keys.some(key => !isSafeText(key, MAX_MODEL_BYTES))) {
    return 'RESULT_MODEL_USAGE_INVALID';
  }
  if (keys.length > 1) return 'MODEL_CONFLICT';
  models.add(keys[0]);
  return null;
}

function freezeCandidate(candidate) {
  return Object.freeze({
    parserContractVersion: candidate.parserContractVersion,
    sessionId: candidate.sessionId,
    requestedModel: candidate.requestedModel,
    observedModel: candidate.observedModel,
    resultSubtype: candidate.resultSubtype,
    isError: candidate.isError,
    numTurns: candidate.numTurns,
    stopReason: 'UNKNOWN',
    truncated: 'UNKNOWN',
    provenance: 'UNKNOWN'
  });
}

function report(diagnostic, candidate = null) {
  return Object.freeze({
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    captureVersion: CAPTURE_VERSION,
    status: 'UNVERIFIED',
    diagnostic,
    promotesTrustedRuntime: false,
    candidate: candidate ? freezeCandidate(candidate) : null
  });
}

class JsonParser {
  constructor(text) {
    this.text = text;
    this.index = 0;
  }

  parse() {
    this.#skipWhitespace();
    const value = this.#parseValue(0);
    this.#skipWhitespace();
    if (this.index !== this.text.length) throw new ParseError('TRAILING_DATA');
    return value;
  }

  #parseValue(depth) {
    if (depth > MAX_DEPTH) throw new ParseError('DEPTH_LIMIT');
    if (this.index >= this.text.length) throw new ParseError('UNEXPECTED_EOF');
    const char = this.text[this.index];
    if (char === '{') return this.#parseObject(depth + 1);
    if (char === '[') return this.#parseArray(depth + 1);
    if (char === '"') return this.#parseString();
    if (char === 't') return this.#parseLiteral('true', true);
    if (char === 'f') return this.#parseLiteral('false', false);
    if (char === 'n') return this.#parseLiteral('null', null);
    if (char === '-' || (char >= '0' && char <= '9')) return this.#parseNumber();
    throw new ParseError('INVALID_JSON');
  }

  #parseObject(depth) {
    this.#expect('{');
    this.#skipWhitespace();
    const out = Object.create(null);
    const keys = new Set();
    if (this.#peek() === '}') {
      this.index += 1;
      return out;
    }
    while (true) {
      if (this.#peek() !== '"') throw new ParseError('INVALID_OBJECT_KEY');
      const key = this.#parseString();
      if (keys.has(key)) throw new ParseError('DUPLICATE_KEY');
      keys.add(key);
      this.#skipWhitespace();
      this.#expect(':');
      this.#skipWhitespace();
      Object.defineProperty(out, key, {
        value: this.#parseValue(depth),
        enumerable: true,
        writable: true,
        configurable: true
      });
      this.#skipWhitespace();
      const next = this.#peek();
      if (next === '}') {
        this.index += 1;
        return out;
      }
      if (next !== ',') throw new ParseError('INVALID_JSON');
      this.index += 1;
      this.#skipWhitespace();
    }
  }

  #parseArray(depth) {
    this.#expect('[');
    this.#skipWhitespace();
    const out = [];
    if (this.#peek() === ']') {
      this.index += 1;
      return out;
    }
    while (true) {
      out.push(this.#parseValue(depth));
      this.#skipWhitespace();
      const next = this.#peek();
      if (next === ']') {
        this.index += 1;
        return out;
      }
      if (next !== ',') throw new ParseError('INVALID_JSON');
      this.index += 1;
      this.#skipWhitespace();
    }
  }

  #parseString() {
    const start = this.index;
    this.#expect('"');
    let escaped = false;
    while (this.index < this.text.length) {
      const char = this.text[this.index++];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        try {
          return JSON.parse(this.text.slice(start, this.index));
        } catch {
          throw new ParseError('INVALID_STRING');
        }
      }
      if (char < ' ') throw new ParseError('INVALID_CONTROL_CHAR');
    }
    throw new ParseError('UNTERMINATED_STRING');
  }

  #parseLiteral(name, value) {
    if (this.text.slice(this.index, this.index + name.length) !== name) {
      throw new ParseError('INVALID_LITERAL');
    }
    this.index += name.length;
    return value;
  }

  #parseNumber() {
    const start = this.index;
    if (this.#peek() === '-') this.index += 1;
    const first = this.#peek();
    if (first === '0') {
      this.index += 1;
    } else {
      if (!(first >= '1' && first <= '9')) throw new ParseError('INVALID_NUMBER');
      this.index += 1;
      while (this.#peek() >= '0' && this.#peek() <= '9') this.index += 1;
    }
    if (this.#peek() === '.') {
      this.index += 1;
      if (!(this.#peek() >= '0' && this.#peek() <= '9')) throw new ParseError('INVALID_NUMBER');
      while (this.#peek() >= '0' && this.#peek() <= '9') this.index += 1;
    }
    const exponent = this.#peek();
    if (exponent === 'e' || exponent === 'E') {
      this.index += 1;
      const sign = this.#peek();
      if (sign === '+' || sign === '-') this.index += 1;
      if (!(this.#peek() >= '0' && this.#peek() <= '9')) throw new ParseError('INVALID_NUMBER');
      while (this.#peek() >= '0' && this.#peek() <= '9') this.index += 1;
    }
    const number = Number(this.text.slice(start, this.index));
    if (!Number.isFinite(number)) throw new ParseError('NONFINITE_NUMBER');
    return number;
  }

  #expect(char) {
    if (this.text[this.index] !== char) throw new ParseError('INVALID_JSON');
    this.index += 1;
  }

  #peek() {
    return this.text[this.index];
  }

  #skipWhitespace() {
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      if (char !== ' ' && char !== '\n' && char !== '\r' && char !== '\t') break;
      this.index += 1;
    }
  }
}

function parseJsonBytes(rawBytes) {
  if (!(rawBytes instanceof Uint8Array) || rawBytes.length > MAX_BYTES) {
    throw new ParseError('INPUT_BOUND');
  }
  let text;
  try {
    text = new TextDecoder('utf-8', {fatal: true}).decode(rawBytes);
  } catch {
    throw new ParseError('INVALID_UTF8');
  }
  return new JsonParser(text).parse();
}

function reject(diagnostic) {
  return report(diagnostic);
}

export function captureClaudeRuntimeCandidate(rawBytes, {parserContractVersion, requestedModel} = {}) {
  try {
    const parserVersion = safeParserVersion(parserContractVersion);
    if (!parserVersion) return reject('PARSER_CONTRACT_VERSION_INVALID');
    if (parserVersion !== SUPPORTED_PARSER_CONTRACT_VERSION) {
      return reject('UNSUPPORTED_PARSER_CONTRACT_VERSION');
    }
    if (!isSafeOptionalText(requestedModel, MAX_MODEL_BYTES)) return reject('REQUESTED_MODEL_INVALID');

    const data = parseJsonBytes(rawBytes);
    if (!Array.isArray(data) || data.length === 0 || data.length > MAX_RECORDS
      || !data.every(item => isRecord(item))) {
      return reject('INPUT_REJECTED');
    }

    let initRecord = null;
    let initCount = 0;
    let resultRecord = null;
    let resultCount = 0;
    let resultIndex = -1;

    const observedModels = new Set();
    let resolvedSessionId = null;
    for (let index = 0; index < data.length; index++) {
      const record = data[index];
      if (record?.type === 'system' && record?.subtype === 'init') {
        initCount += 1;
        initRecord = record;
      }
      if (record?.type === 'result') {
        resultCount += 1;
        resultRecord = record;
        resultIndex = index;
      }

      if (record?.type !== 'result' && hasOwn(record, 'session_id')) {
        if (!isSafeText(record.session_id, MAX_ID_BYTES)) return reject('SESSION_ID_INVALID');
        if (!resolvedSessionId) resolvedSessionId = record.session_id;
        else if (resolvedSessionId !== record.session_id) return reject('SESSION_CONFLICT');
      }

      if (record?.type === 'assistant') {
        const message = record.message;
        if (isRecord(message) && hasOwn(message, 'model')) {
          if (!isSafeText(message.model, MAX_MODEL_BYTES)) return reject('ASSISTANT_MODEL_INVALID');
          observedModels.add(message.model);
        }
      }
    }

    if (initCount !== 1 || !initRecord) return reject('INIT_MISSING_OR_AMBIGUOUS');
    if (resultCount !== 1 || !resultRecord) return reject('RESULT_MISSING_OR_AMBIGUOUS');
    if (resultIndex !== data.length - 1) return reject('RESULT_NOT_TERMINAL');

    if (!isSafeText(initRecord.session_id, MAX_ID_BYTES)) return reject('SESSION_ID_INVALID');
    if (resolvedSessionId && resolvedSessionId !== initRecord.session_id) return reject('SESSION_CONFLICT');

    const initModel = ownString(initRecord, 'model', MAX_MODEL_BYTES);
    if (initModel.invalid) return reject('INIT_MODEL_INVALID');
    if (initModel.present) observedModels.add(initModel.value);

    const resultSession = ownString(resultRecord, 'session_id', MAX_ID_BYTES);
    if (resultSession.invalid) return reject('RESULT_SESSION_ID_INVALID');
    if (resultSession.present && resultSession.value !== initRecord.session_id) return reject('SESSION_CONFLICT');
    if (resolvedSessionId && resolvedSessionId !== initRecord.session_id) return reject('SESSION_CONFLICT');

    const resultSubtype = resultRecord?.subtype;
    if (!isSafeText(resultSubtype, MAX_SUBTYPE_BYTES)
      || !ALLOWED_RESULT_SUBTYPES.has(resultSubtype)) {
      return reject('RESULT_SUBTYPE_INVALID');
    }
    if (typeof resultRecord?.is_error !== 'boolean') return reject('RESULT_FLAG_INVALID');
    if (!Number.isSafeInteger(resultRecord?.num_turns) || resultRecord.num_turns < 0) {
      return reject('RESULT_TURN_COUNT_INVALID');
    }

    const resultModelUsage = collectModelFromModelUsage(resultRecord, observedModels);
    if (resultModelUsage) return reject(resultModelUsage);

    const observedModel = observedModels.size === 0 ? 'UNKNOWN' : observedModels.size === 1
      ? [...observedModels][0]
      : null;
    if (!observedModel) return reject('MODEL_CONFLICT');

    const candidate = {
      parserContractVersion: parserVersion,
      sessionId: initRecord.session_id,
      requestedModel: requestedModel ?? 'UNKNOWN',
      observedModel,
      resultSubtype,
      isError: resultRecord.is_error,
      numTurns: resultRecord.num_turns
    };
    return report('CAPTURED_UNVERIFIED', candidate);
  } catch {
    return reject('INPUT_REJECTED');
  }
}

export {
  ALLOWED_RESULT_SUBTYPES,
  CAPTURE_SCHEMA_VERSION,
  CAPTURE_VERSION,
  MAX_BYTES,
  MAX_DEPTH,
  MAX_RECORDS,
  SUPPORTED_PARSER_CONTRACT_VERSION
};
