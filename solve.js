// csv-reader-speed-01 — V5 (draft): V2's scanner with the unquoted-field
// scan unrolled two characters per step. Semantics follow
// vendor/csv-reader 1.0.0 exactly (BOM, CRLF, stray CR, quoted fields
// with "" escapes, CRLF/lone-CR-in-quotes -> LF, quote_junk,
// unterminated quote re-read as unquoted, short/long row padding, error
// order and {code, line, row} with the record's start line).
//
// Idea: the unquoted scan is the hot loop (about 10M characters a set).
// Checking two characters per iteration halves its loop overhead: the
// scan stops at the first of ',' '\n' '\r', and the field-end code after
// it is shared for comma, line break, end of text and stray CR (a stray
// CR drops the character, records the error and resumes the same field).
// Quoted fields use the indexOf + span-check path (first '"' is the
// closing quote unless doubled; the span itself is checked for \r/\n).

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const rows = [];
  const errors = [];
  let columns = null;
  let width = -1;
  let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let line = 1;

  // Field end kinds.
  const COMMA = 0, BREAK = 1, END = 2;

  while (true) {
    // Skip lines left with no characters (LF or CRLF each count one line).
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = (header && columns === null) ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended = COMMA;

    do {
      if (text.charCodeAt(pos) === 34) {
        // ---- quoted field ----
        quoted = true;
        const open = pos;
        const openLine = line;
        const close = text.indexOf('"', pos + 1);
        let value;
        if (close === -1) {
          // Unterminated: the quote is literal, re-read from open+1 unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          let ustart = pos;
          let uparts = ['"'];
          ended = END;
          for (;;) {
            while (pos < n) {
              let c = text.charCodeAt(pos);
              if (c === 44 || c === 10 || c === 13) break;
              c = text.charCodeAt(pos + 1);
              if (c === 44 || c === 10 || c === 13) { pos += 1; break; }
              pos += 2;
            }
            if (pos >= n) {
              if (pos > ustart) uparts.push(text.slice(ustart, pos));
              fields.push(uparts.length === 1 ? '"' : uparts.join(''));
              ended = END;
              break;
            }
            const c = text.charCodeAt(pos);
            if (c === 44) {
              if (pos > ustart) uparts.push(text.slice(ustart, pos));
              fields.push(uparts.length === 1 ? '"' : uparts.join(''));
              pos += 1; ended = COMMA;
              break;
            }
            if (c === 10) {
              if (pos > ustart) uparts.push(text.slice(ustart, pos));
              fields.push(uparts.length === 1 ? '"' : uparts.join(''));
              pos += 1; line += 1; ended = BREAK;
              break;
            }
            if (text.charCodeAt(pos + 1) === 10) {
              if (pos > ustart) uparts.push(text.slice(ustart, pos));
              fields.push(uparts.length === 1 ? '"' : uparts.join(''));
              pos += 2; line += 1; ended = BREAK;
              break;
            }
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            if (pos > ustart) uparts.push(text.slice(ustart, pos));
            pos += 1; ustart = pos;
          }
          continue;
        }
        if (text.charCodeAt(close + 1) === 34) {
          // A doubled quote sits in the span: character loop for this field.
          let start = pos + 1;
          let scan = start;
          let parts = null;
          let closed = false;
          while (scan < n) {
            const c = text.charCodeAt(scan);
            if (c === 34) {
              if (text.charCodeAt(scan + 1) === 34) {
                if (parts === null) parts = [text.slice(start, scan)];
                else parts.push(text.slice(start, scan));
                parts.push('"');
                scan += 2; start = scan;
                continue;
              }
              closed = true;
              break;
            }
            if (c === 13) {
              if (parts === null) parts = [text.slice(start, scan)];
              else parts.push(text.slice(start, scan));
              parts.push('\n');
              line += 1;
              scan += text.charCodeAt(scan + 1) === 10 ? 2 : 1;
              start = scan;
              continue;
            }
            if (c === 10) line += 1;
            scan += 1;
          }
          if (!closed) {
            pos = open + 1;
            line = openLine;
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            let ustart = pos;
            let uparts = ['"'];
            ended = END;
            for (;;) {
              while (pos < n) {
                let c = text.charCodeAt(pos);
                if (c === 44 || c === 10 || c === 13) break;
                c = text.charCodeAt(pos + 1);
                if (c === 44 || c === 10 || c === 13) { pos += 1; break; }
                pos += 2;
              }
              if (pos >= n) {
                if (pos > ustart) uparts.push(text.slice(ustart, pos));
                fields.push(uparts.length === 1 ? '"' : uparts.join(''));
                ended = END;
                break;
              }
              const c = text.charCodeAt(pos);
              if (c === 44) {
                if (pos > ustart) uparts.push(text.slice(ustart, pos));
                fields.push(uparts.length === 1 ? '"' : uparts.join(''));
                pos += 1; ended = COMMA;
                break;
              }
              if (c === 10) {
                if (pos > ustart) uparts.push(text.slice(ustart, pos));
                fields.push(uparts.length === 1 ? '"' : uparts.join(''));
                pos += 1; line += 1; ended = BREAK;
                break;
              }
              if (text.charCodeAt(pos + 1) === 10) {
                if (pos > ustart) uparts.push(text.slice(ustart, pos));
                fields.push(uparts.length === 1 ? '"' : uparts.join(''));
                pos += 2; line += 1; ended = BREAK;
                break;
              }
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              if (pos > ustart) uparts.push(text.slice(ustart, pos));
              pos += 1; ustart = pos;
            }
            continue;
          }
          value = parts === null ? text.slice(start, scan) : (parts.push(text.slice(start, scan)), parts.join(''));
          pos = scan + 1;
        } else {
          // First quote is the closing quote; check the span for breaks.
          value = text.slice(pos + 1, close);
          if (value.indexOf('\r') !== -1 || value.indexOf('\n') !== -1) {
            let start = pos + 1;
            let scan = start;
            let parts = null;
            while (scan < close) {
              const c = text.charCodeAt(scan);
              if (c === 13) {
                if (parts === null) parts = [text.slice(start, scan)];
                else parts.push(text.slice(start, scan));
                parts.push('\n');
                line += 1;
                scan += text.charCodeAt(scan + 1) === 10 ? 2 : 1;
                start = scan;
                continue;
              }
              if (c === 10) line += 1;
              scan += 1;
            }
            value = parts === null ? text.slice(start, close) : (parts.push(text.slice(start, close)), parts.join(''));
          }
          pos = close + 1;
        }
        // Past the closing quote: comma, line break, end, or junk.
        if (pos >= n) {
          fields.push(value);
          ended = END;
          continue;
        }
        const c = text.charCodeAt(pos);
        if (c === 44) { fields.push(value); pos += 1; ended = COMMA; continue; }
        if (c === 10) { fields.push(value); pos += 1; line += 1; ended = BREAK; continue; }
        if (c === 13 && text.charCodeAt(pos + 1) === 10) { fields.push(value); pos += 2; line += 1; ended = BREAK; continue; }
        // Quote junk: read the rest unquoted, appended as it stands.
        let jstart = pos;
        let jparts = [value];
        let jadded = 0;
        ended = END;
        for (;;) {
          while (pos < n) {
            let c2 = text.charCodeAt(pos);
            if (c2 === 44 || c2 === 10 || c2 === 13) break;
            c2 = text.charCodeAt(pos + 1);
            if (c2 === 44 || c2 === 10 || c2 === 13) { pos += 1; break; }
            pos += 2;
          }
          if (pos >= n) {
            if (pos > jstart) { jparts.push(text.slice(jstart, pos)); jadded += pos - jstart; }
            fields.push(jparts.join(''));
            if (jadded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            ended = END;
            break;
          }
          const c2 = text.charCodeAt(pos);
          if (c2 === 44) {
            if (pos > jstart) { jparts.push(text.slice(jstart, pos)); jadded += pos - jstart; }
            fields.push(jparts.join(''));
            if (jadded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            pos += 1; ended = COMMA;
            break;
          }
          if (c2 === 10) {
            if (pos > jstart) { jparts.push(text.slice(jstart, pos)); jadded += pos - jstart; }
            fields.push(jparts.join(''));
            if (jadded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            pos += 1; line += 1; ended = BREAK;
            break;
          }
          if (text.charCodeAt(pos + 1) === 10) {
            if (pos > jstart) { jparts.push(text.slice(jstart, pos)); jadded += pos - jstart; }
            fields.push(jparts.join(''));
            if (jadded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            pos += 2; line += 1; ended = BREAK;
            break;
          }
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          if (pos > jstart) { jparts.push(text.slice(jstart, pos)); jadded += pos - jstart; }
          pos += 1; jstart = pos;
        }
      } else {
        // ---- unquoted field: unrolled scan, two chars per step ----
        quoted = false;
        let start = pos;
        let parts = null;
        ended = END;
        for (;;) {
          while (pos < n) {
            let c = text.charCodeAt(pos);
            if (c === 44 || c === 10 || c === 13) break;
            c = text.charCodeAt(pos + 1);
            if (c === 44 || c === 10 || c === 13) { pos += 1; break; }
            pos += 2;
          }
          if (pos >= n) {
            fields.push(parts === null ? text.slice(start, pos) : (parts.push(text.slice(start, pos)), parts.join('')));
            ended = END;
            break;
          }
          const c = text.charCodeAt(pos);
          if (c === 44) {
            fields.push(parts === null ? text.slice(start, pos) : (parts.push(text.slice(start, pos)), parts.join('')));
            pos += 1; ended = COMMA;
            break;
          }
          if (c === 10) {
            fields.push(parts === null ? text.slice(start, pos) : (parts.push(text.slice(start, pos)), parts.join('')));
            pos += 1; line += 1; ended = BREAK;
            break;
          }
          if (text.charCodeAt(pos + 1) === 10) {
            fields.push(parts === null ? text.slice(start, pos) : (parts.push(text.slice(start, pos)), parts.join('')));
            pos += 2; line += 1; ended = BREAK;
            break;
          }
          // Stray CR: drop it, record the error, keep scanning this field.
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          if (parts === null) parts = [text.slice(start, pos)];
          else parts.push(text.slice(start, pos));
          pos += 1; start = pos;
        }
      }
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
