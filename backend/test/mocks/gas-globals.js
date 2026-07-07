'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Mocks minimos del runtime de Google Apps Script, suficientes para probar
 * el contrato de transporte (doPost/doGet) fuera de Google, sin dependencias
 * externas (node:vm + node:test, ambos incluidos en Node).
 *
 * No pretenden replicar el comportamiento real de Apps Script: solo el
 * subconjunto que Code.gs usa en Fase 0.
 */

function createContentServiceMock() {
  const MimeType = { JSON: 'JSON', TEXT: 'TEXT' };

  function createTextOutput(text) {
    const output = {
      setMimeType(mime) {
        output._mimeType = mime;
        return output;
      },
      getContent() {
        return text;
      },
      getMimeType() {
        return output._mimeType || null;
      }
    };
    return output;
  }

  return { createTextOutput, MimeType };
}

function createPropertiesServiceMock(initialProps) {
  const values = Object.assign({}, initialProps);
  const store = {
    getProperties() {
      return Object.assign({}, values);
    },
    getProperty(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setProperty(key, value) {
      values[key] = value;
      return store;
    }
  };
  return { getScriptProperties: () => store };
}

function createUtilitiesMock() {
  let counter = 0;
  const DigestAlgorithm = { MD5: 'MD5' };
  const Charset = { UTF_8: 'UTF_8' };

  return {
    DigestAlgorithm,
    Charset,
    getUuid() {
      counter += 1;
      return 'test-uuid-' + counter;
    },
    // No es MD5 real: alcanza para probar que el hash es deterministico y
    // estable, que es lo unico que la deduplicacion (RF-F06) necesita.
    computeDigest(_algorithm, text) {
      const bytes = [];
      let acc = 0;
      for (let i = 0; i < text.length; i++) {
        acc = (acc * 31 + text.charCodeAt(i)) & 0xffffffff;
        if (i % 2 === 1) {
          bytes.push(acc & 0xff);
        }
      }
      while (bytes.length < 16) bytes.push(acc & 0xff);
      return bytes.slice(0, 16);
    },
    base64Decode(texto) {
      // Fiel al Apps Script real: Utilities.base64Decode devuelve Byte[] CON
      // SIGNO (-128..127), no 0..255. Replicarlo aqui es lo que hace que el
      // test cace el bug de deteccion de firma (0x89/0xFF) en Drive.gs.
      return Array.from(Buffer.from(texto, 'base64'), (b) => (b > 127 ? b - 256 : b));
    },
    base64Encode(bytesOrString) {
      const buffer = Buffer.isBuffer(bytesOrString) || Array.isArray(bytesOrString)
        ? Buffer.from(bytesOrString)
        : Buffer.from(String(bytesOrString));
      return buffer.toString('base64');
    },
    // Utilities.newBlob(data, contentType, name) — usado por subirArchivo
    // (§5.3) para envolver el archivo antes de escribirlo en Drive.
    newBlob(data, contentType, nombre) {
      let buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      let nombreActual = nombre || '';
      const blob = {
        getBytes: () => Array.from(buffer),
        getContentType: () => contentType || '',
        getName: () => nombreActual,
        setName(n) {
          nombreActual = n;
          return blob;
        },
        getSize: () => buffer.length
      };
      return blob;
    }
  };
}

function createDriveAppMock() {
  let contador = 0;
  const nodos = {};

  function crearId() {
    contador += 1;
    return 'drive-' + contador;
  }

  function crearFolder(nombre, padreId) {
    const id = crearId();
    nodos[id] = { tipo: 'folder', nombre, padreId: padreId || null, folders: {}, archivos: {} };
    return id;
  }

  const raizId = crearFolder('SIGSO_Sistema', null);

  function folderWrapper(id) {
    return {
      getId: () => id,
      getName: () => nodos[id].nombre,
      getFoldersByName(nombre) {
        const encontrados = Object.keys(nodos[id].folders).filter((fid) => nodos[fid].nombre === nombre);
        let i = 0;
        return { hasNext: () => i < encontrados.length, next: () => folderWrapper(encontrados[i++]) };
      },
      createFolder(nombre) {
        const nuevoId = crearFolder(nombre, id);
        nodos[id].folders[nuevoId] = true;
        return folderWrapper(nuevoId);
      },
      createFile(blob) {
        const fileId = crearId();
        nodos[fileId] = { tipo: 'file', nombre: blob.getName(), padreId: id, blob };
        nodos[id].archivos[fileId] = true;
        return fileWrapper(fileId);
      },
      getFilesByName(nombre) {
        const encontrados = Object.keys(nodos[id].archivos).filter((fid) => nodos[fid].nombre === nombre);
        let i = 0;
        return { hasNext: () => i < encontrados.length, next: () => fileWrapper(encontrados[i++]) };
      }
    };
  }

  function fileWrapper(id) {
    return {
      getId: () => id,
      getName: () => nodos[id].nombre,
      setName(nombre) {
        nodos[id].nombre = nombre;
        return fileWrapper(id);
      },
      getUrl: () => 'https://drive.mock/file/' + id,
      getBlob: () => nodos[id].blob
    };
  }

  return {
    getRootFolder: () => folderWrapper(raizId),
    // En Apps Script real, el ID de la carpeta raiz ya existe (lo crea el
    // Admin, §11.1, y se guarda en Script Properties). El mock no tiene esa
    // carpeta real, asi que si el id no fue visto antes lo registra como
    // una carpeta nueva con ese mismo id -- alcanza para probar la logica
    // de navegacion/creacion de subcarpetas sin necesitar un fixture aparte.
    getFolderById(id) {
      if (!nodos[id]) {
        nodos[id] = { tipo: 'folder', nombre: id, padreId: null, folders: {}, archivos: {} };
      }
      return folderWrapper(id);
    },
    getFileById: (id) => fileWrapper(id)
  };
}

function createDocumentAppMock() {
  let contador = 0;
  const documentos = {};

  function crearId() {
    contador += 1;
    return 'doc-' + contador;
  }

  function bodyWrapper(id) {
    return {
      replaceText(patron, reemplazo) {
        documentos[id].contenido = documentos[id].contenido.split(patron).join(reemplazo);
        return bodyWrapper(id);
      },
      appendParagraph(texto) {
        documentos[id].contenido += '\n' + texto;
        return bodyWrapper(id);
      },
      getText: () => documentos[id].contenido
    };
  }

  function docWrapper(id) {
    return {
      getId: () => id,
      getName: () => documentos[id].nombre,
      getBody: () => bodyWrapper(id),
      saveAndClose() {},
      // Exporta un blob "PDF" simulado: alcanza para probar que la cola de
      // documentos guarda el contenido y las URLs correctas, sin depender
      // de un motor real de conversion a PDF.
      getAs(mimeType) {
        const contenido = documentos[id].contenido;
        return {
          getName: () => documentos[id].nombre + (mimeType === 'application/pdf' ? '.pdf' : ''),
          getContentType: () => mimeType,
          getBytes: () => Array.from(Buffer.from(contenido, 'utf8')),
          _contenido: contenido
        };
      }
    };
  }

  return {
    create(nombre) {
      const id = crearId();
      documentos[id] = { nombre, contenido: '' };
      return docWrapper(id);
    },
    openById(id) {
      return docWrapper(id);
    },
    // Helper de test/produccion: crea un doc ya con el texto de la
    // plantilla (simula copiar SIGSO_Templates/template_solicitud.gdoc).
    _crearDesdeTexto(nombre, textoPlantilla) {
      const id = crearId();
      documentos[id] = { nombre, contenido: textoPlantilla };
      return docWrapper(id);
    }
  };
}

function createGmailAppMock() {
  const enviados = [];
  let fallar = () => false;

  return {
    sendEmail(destinatario, asunto, cuerpo, opciones) {
      if (fallar(destinatario, asunto)) {
        throw new Error('Service invoked too many times: cuota de Gmail excedida (simulado)');
      }
      enviados.push({ destinatario, asunto, cuerpo, opciones: opciones || {} });
    },
    _enviados: enviados,
    // Solo para pruebas: fuerza que el proximo/los proximos envios fallen.
    _forzarFallo(fn) {
      fallar = fn;
    }
  };
}

function createScriptAppMock() {
  const triggers = [];
  return {
    WeekDay: {
      MONDAY: 'MONDAY', TUESDAY: 'TUESDAY', WEDNESDAY: 'WEDNESDAY', THURSDAY: 'THURSDAY',
      FRIDAY: 'FRIDAY', SATURDAY: 'SATURDAY', SUNDAY: 'SUNDAY'
    },
    newTrigger(nombreFuncion) {
      const config = { functionName: nombreFuncion };
      const builder = {
        timeBased: () => builder,
        everyMinutes(n) {
          config.everyMinutes = n;
          return builder;
        },
        everyDays(n) {
          config.everyDays = n;
          return builder;
        },
        atHour(h) {
          config.atHour = h;
          return builder;
        },
        onWeekDay(dia) {
          config.onWeekDay = dia;
          return builder;
        },
        onMonthDay(dia) {
          config.onMonthDay = dia;
          return builder;
        },
        create() {
          triggers.push(config);
          return { getUniqueId: () => 'trigger-' + triggers.length };
        }
      };
      return builder;
    },
    getProjectTriggers() {
      return triggers.map((t) => ({ getHandlerFunction: () => t.functionName }));
    },
    deleteTrigger() {},
    _triggers: triggers
  };
}

// CacheService real expira por tiempo (segundos); el mock usa Date.now()
// para poder probar tanto el hit de cache como su expiracion (C-13).
function createCacheServiceMock() {
  const almacen = new Map();

  const cache = {
    get(clave) {
      const entrada = almacen.get(clave);
      if (!entrada) return null;
      if (Date.now() > entrada.expiraEn) {
        almacen.delete(clave);
        return null;
      }
      return entrada.valor;
    },
    put(clave, valor, segundos) {
      const ttl = segundos || 600;
      almacen.set(clave, { valor, expiraEn: Date.now() + ttl * 1000 });
    },
    remove(clave) {
      almacen.delete(clave);
    }
  };

  return { getScriptCache: () => cache };
}

function createRangeMock(rowsRef, startRow, startCol, numRows, numCols) {
  return {
    getValues() {
      const values = [];
      for (let i = 0; i < numRows; i++) {
        const row = rowsRef[startRow - 1 + i] || [];
        const slice = [];
        for (let j = 0; j < numCols; j++) {
          const v = row[startCol - 1 + j];
          slice.push(v === undefined ? '' : v);
        }
        values.push(slice);
      }
      return values;
    },
    setValues(values) {
      for (let i = 0; i < values.length; i++) {
        const rowIndex = startRow - 1 + i;
        while (rowsRef.length <= rowIndex) rowsRef.push([]);
        const row = rowsRef[rowIndex];
        for (let j = 0; j < values[i].length; j++) {
          row[startCol - 1 + j] = values[i][j];
        }
      }
    },
    getValue() {
      return this.getValues()[0][0];
    },
    setValue(v) {
      this.setValues([[v]]);
    }
  };
}

function createSheetMock(name) {
  let rows = [];
  const sheet = {
    getName: () => name,
    getLastRow: () => rows.length,
    getLastColumn: () => (rows[0] ? rows[0].length : 0),
    appendRow(rowArray) {
      rows.push(rowArray.slice());
      return sheet;
    },
    getRange(row, col, numRows, numCols) {
      const nRows = numRows || 1;
      const nCols = numCols || (rows[0] ? rows[0].length - col + 1 : 1);
      return createRangeMock(rows, row, col, nRows, nCols);
    },
    getDataRange() {
      const numCols = rows.reduce((max, r) => Math.max(max, r.length), 0);
      return createRangeMock(rows, 1, 1, rows.length, numCols || 1);
    },
    _getRows() {
      return rows;
    }
  };
  return sheet;
}

function createSpreadsheetAppMock() {
  const sheets = {};
  const spreadsheet = {
    getSheetByName(name) {
      return sheets[name] || null;
    },
    insertSheet(name) {
      if (sheets[name]) {
        throw new Error('La hoja ya existe: ' + name);
      }
      sheets[name] = createSheetMock(name);
      return sheets[name];
    },
    getSheets() {
      return Object.keys(sheets).map((name) => sheets[name]);
    }
  };
  return {
    openById: () => spreadsheet,
    getActiveSpreadsheet: () => spreadsheet,
    _spreadsheet: spreadsheet
  };
}

function createLockServiceMock() {
  let locked = false;
  return {
    getScriptLock() {
      return {
        waitLock() {
          if (locked) {
            throw new Error('No se pudo obtener el lock: ya esta tomado');
          }
          locked = true;
        },
        releaseLock() {
          locked = false;
        }
      };
    }
  };
}

function createLoggerMock() {
  const lines = [];
  return {
    log(msg) {
      lines.push(msg);
    },
    _lines: lines
  };
}

function createSessionMock(email) {
  return {
    getActiveUser() {
      return { getEmail: () => email || '' };
    }
  };
}

// Fase 8: App.html/Admin.html se sirven via HtmlService.createHtmlOutputFromFile
// (Code.gs, doGet). No hay scriptlets <?!= ?> que evaluar (todo el CSS/JS ya
// viene inlineado por backend/build-backoffice-html.js), asi que el mock solo
// necesita leer el archivo tal cual del proyecto y exponer las mismas
// llamadas encadenables que usa el codigo real.
function createHtmlServiceMock(htmlDir) {
  function crearSalida(contenido) {
    const salida = {
      _contenido: contenido,
      setTitle() { return salida; },
      addMetaTag() { return salida; },
      getContent() { return salida._contenido; }
    };
    return salida;
  }
  return {
    createHtmlOutputFromFile(nombre) {
      const archivo = nombre.endsWith('.html') ? nombre : nombre + '.html';
      const contenido = fs.readFileSync(path.join(htmlDir, archivo), 'utf8');
      return crearSalida(contenido);
    },
    createHtmlOutput(contenido) {
      return crearSalida(contenido || '');
    }
  };
}

/**
 * @param {object} [options]
 * @param {object} [options.scriptProperties] valores iniciales de Script Properties
 * @param {string} [options.activeUserEmail] email simulado de Session.getActiveUser()
 */
function createGasGlobals(options) {
  const opts = options || {};
  // MailApp y GmailApp comparten el mismo mock: el codigo real usa MailApp
  // (solo necesita el scope script.send_mail para enviar, en vez del scope
  // completo de Gmail), pero los tests siguen leyendo ctx.GmailApp._enviados.
  const correo = createGmailAppMock();
  return {
    ContentService: createContentServiceMock(),
    PropertiesService: createPropertiesServiceMock(opts.scriptProperties),
    Utilities: createUtilitiesMock(),
    Logger: createLoggerMock(),
    Session: createSessionMock(opts.activeUserEmail),
    SpreadsheetApp: createSpreadsheetAppMock(),
    LockService: createLockServiceMock(),
    DriveApp: createDriveAppMock(),
    DocumentApp: createDocumentAppMock(),
    GmailApp: correo,
    MailApp: correo,
    ScriptApp: createScriptAppMock(),
    CacheService: createCacheServiceMock(),
    HtmlService: createHtmlServiceMock(opts.htmlDir)
  };
}

module.exports = { createGasGlobals };
