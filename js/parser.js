/**
 * parser.js
 * Handles parsing of Siemens exported TXT files.
 */

window.SiemensParser = (function() {
    'use strict';

    function extractSection(text, sectionName) {
        const beginMarker = `BEGIN_${sectionName}`;
        const endMarker = `END_${sectionName}`;
        const beginIdx = text.indexOf(beginMarker);
        if (beginIdx === -1) return '';
        const endIdx = text.indexOf(endMarker, beginIdx);
        if (endIdx === -1) return '';
        return text.substring(beginIdx + beginMarker.length, endIdx).trim();
    }

    function parseCompProps(rawText) {
        const compDb = {};
        const lines = rawText.split('\n');
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            // Expected: C102:'C0805C104K','CAP_100NF','100nF'
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
                const refdes = line.substring(0, colonIdx).trim();
                const propsRaw = line.substring(colonIdx + 1).trim();
                // Split properties by comma, ignoring quotes
                const props = propsRaw.split(',').map(p => p.trim().replace(/^'|'$/g, ''));
                compDb[refdes] = {
                    refdes: refdes,
                    properties: props
                };
            }
        }
        return compDb;
    }

    function parseCompPins(rawText, compDb, pinDb) {
        const lines = rawText.split('\n');
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            // Expected: C102((1:1),(2:2))
            const parenIdx = line.indexOf('(');
            if (parenIdx > 0) {
                const refdes = line.substring(0, parenIdx).trim();
                const pinsRaw = line.substring(parenIdx).trim();
                // Match patterns like (1:1) or (1:PGOOD)
                const pinRegex = /\(([^)]+)\)/g;
                let match;
                while ((match = pinRegex.exec(pinsRaw)) !== null) {
                    const inner = match[1]; // e.g. 1:1 or 1:PGOOD
                    // Ignore double parenthesis enclosure if it matches the whole block
                    if (inner.includes('(')) continue; 
                    const parts = inner.split(':');
                    if (parts.length >= 2) {
                        const pinNum = parts[0].trim();
                        const pinName = parts[1].trim();
                        const pinKey = `${refdes}.${pinNum}`;
                        pinDb[pinKey] = {
                            refdes: refdes,
                            pin: pinNum,
                            pinName: pinName
                        };
                    }
                }
            }
        }
    }

    function parseNets(rawText, pinNetDb, netDb) {
        // Expected: +5V:C102(1:1),R10(1:1);
        // Replace newlines that might break a statement before semicolon
        const normalized = rawText.replace(/\r?\n/g, '');
        const statements = normalized.split(';');
        
        for (let stmt of statements) {
            stmt = stmt.trim();
            if (!stmt) continue;
            const colonIdx = stmt.indexOf(':');
            if (colonIdx > 0) {
                const netName = stmt.substring(0, colonIdx).trim();
                const connectionsRaw = stmt.substring(colonIdx + 1).trim();
                
                if (!netDb[netName]) {
                    netDb[netName] = [];
                }

                // Connections are comma separated: C102(1:1), R10(1:1)
                // However, they contain parens, so we split carefully or match via Regex
                // Match: RefDes(PinNumber:PinName)
                const connRegex = /([A-Za-z0-9_]+)\(([^)]+)\)/g;
                let match;
                while ((match = connRegex.exec(connectionsRaw)) !== null) {
                    const refdes = match[1].trim();
                    const inner = match[2].trim(); // e.g., 1:1
                    const parts = inner.split(':');
                    const pinNum = parts[0].trim();
                    const pinKey = `${refdes}.${pinNum}`;
                    
                    netDb[netName].push(pinKey);
                    pinNetDb[pinKey] = {
                        net: netName
                    };
                }
            }
        }
    }

    function buildDatabase(text) {
        const compPropsRaw = extractSection(text, 'COMPPROPS');
        const compPinsRaw = extractSection(text, 'COMPPINS');
        const netsRaw = extractSection(text, 'NETS');

        const compDb = parseCompProps(compPropsRaw);
        const pinDb = {};
        const pinNetDb = {};
        const netDb = {};

        parseCompPins(compPinsRaw, compDb, pinDb);
        parseNets(netsRaw, pinNetDb, netDb);

        return {
            compDb,
            pinDb,
            pinNetDb,
            netDb
        };
    }

    return {
        buildDatabase: buildDatabase
    };
})();
