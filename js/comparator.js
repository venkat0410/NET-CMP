/**
 * comparator.js
 * Engine to compare OLD and NEW parsed databases.
 */

window.SiemensComparator = (function() {
    'use strict';

    function compare(oldData, newData) {
        const componentChanges = compareComponents(oldData.compDb, newData.compDb);
        const netRenames = detectNetRenames(oldData.netDb, newData.netDb);
        const netChanges = compareNets(oldData.netDb, newData.netDb, netRenames);
        const connectivityChanges = compareConnectivity(oldData, newData, netRenames);

        return {
            componentsAdded: componentChanges.added,
            componentsDeleted: componentChanges.deleted,
            componentsModified: componentChanges.modified,
            connectivityChanges: connectivityChanges,
            netRenames: netRenames,
            netsAdded: netChanges.added,
            netsDeleted: netChanges.deleted
        };
    }

    function compareComponents(oldCompDb, newCompDb) {
        const added = [];
        const deleted = [];
        const modified = [];

        // Deleted components
        for (const refdes in oldCompDb) {
            if (!newCompDb[refdes]) {
                deleted.push({
                    refdes: refdes,
                    oldProperties: oldCompDb[refdes].properties,
                    newProperties: null
                });
            }
        }

        // Added components
        for (const refdes in newCompDb) {
            if (!oldCompDb[refdes]) {
                added.push({
                    refdes: refdes,
                    oldProperties: null,
                    newProperties: newCompDb[refdes].properties
                });
            }
        }

        // Modified components
        for (const refdes in oldCompDb) {
            if (newCompDb[refdes]) {
                const oldProps = oldCompDb[refdes].properties;
                const newProps = newCompDb[refdes].properties;
                
                // Compare arrays (assuming order matters or they are structurally similar)
                let isModified = oldProps.length !== newProps.length;
                if (!isModified) {
                    for (let i = 0; i < oldProps.length; i++) {
                        if (oldProps[i] !== newProps[i]) {
                            isModified = true;
                            break;
                        }
                    }
                }

                if (isModified) {
                    modified.push({
                        refdes: refdes,
                        oldProperties: oldProps,
                        newProperties: newProps
                    });
                }
            }
        }

        return { added, deleted, modified };
    }

    function detectNetRenames(oldNetDb, newNetDb) {
        const renames = [];
        const renameMapOldToNew = new Set();
        const renameMapNewToOld = new Set();

        const oldOnly = {};
        for (const name in oldNetDb) {
            if (!newNetDb[name]) oldOnly[name] = oldNetDb[name];
        }

        const newOnly = {};
        for (const name in newNetDb) {
            if (!oldNetDb[name]) newOnly[name] = newNetDb[name];
        }

        const oldFingerprints = {};
        for (const name in oldOnly) {
            const fp = [...oldOnly[name]].sort().join(',');
            if (fp) oldFingerprints[fp] = name;
        }

        for (const name in newOnly) {
            const fp = [...newOnly[name]].sort().join(',');
            if (fp && oldFingerprints[fp]) {
                const oldName = oldFingerprints[fp];
                if (!renameMapOldToNew.has(oldName) && !renameMapNewToOld.has(name)) {
                    renames.push({
                        oldNet: oldName,
                        newNet: name
                    });
                    renameMapOldToNew.add(oldName);
                    renameMapNewToOld.add(name);
                    delete oldFingerprints[fp];
                }
            }
        }

        return renames;
    }

    function compareNets(oldNetDb, newNetDb, netRenames) {
        const renamedOld = new Set(netRenames.map(r => r.oldNet));
        const renamedNew = new Set(netRenames.map(r => r.newNet));

        const added = [];
        const deleted = [];

        for (const name in oldNetDb) {
            if (!newNetDb[name] && !renamedOld.has(name)) {
                deleted.push({ net: name, status: 'Deleted Net' });
            }
        }

        for (const name in newNetDb) {
            if (!oldNetDb[name] && !renamedNew.has(name)) {
                added.push({ net: name, status: 'Added Net' });
            }
        }

        return { added, deleted };
    }

    function compareConnectivity(oldData, newData, netRenames) {
        const results = [];
        
        const oldPinNetDb = oldData.pinNetDb;
        const newPinNetDb = newData.pinNetDb;
        const oldPinDb = oldData.pinDb;
        const newPinDb = newData.pinDb;

        const renameOldToNew = {};
        for (const r of netRenames) {
            renameOldToNew[r.oldNet] = r.newNet;
        }

        const allPins = new Set([...Object.keys(oldPinNetDb), ...Object.keys(newPinNetDb)]);

        for (const pinKey of allPins) {
            const oldNetObj = oldPinNetDb[pinKey];
            const newNetObj = newPinNetDb[pinKey];

            const oldNet = oldNetObj ? oldNetObj.net : null;
            const newNet = newNetObj ? newNetObj.net : null;

            if (oldNet === newNet) continue;
            
            // Check if difference is purely due to rename
            if (oldNet && newNet && renameOldToNew[oldNet] === newNet) continue;

            const dotIdx = pinKey.lastIndexOf('.');
            const refdes = dotIdx > 0 ? pinKey.substring(0, dotIdx) : pinKey;
            const pinNum = dotIdx > 0 ? pinKey.substring(dotIdx + 1) : '';

            // Extract pinName from either old or new Pin DB
            let pinName = '';
            if (newPinDb[pinKey] && newPinDb[pinKey].pinName) {
                pinName = newPinDb[pinKey].pinName;
            } else if (oldPinDb[pinKey] && oldPinDb[pinKey].pinName) {
                pinName = oldPinDb[pinKey].pinName;
            }

            let status = 'Net Changed';
            if (!oldNet && newNet) status = 'Connection Added';
            else if (oldNet && !newNet) status = 'Connection Removed';

            results.push({
                refdes: refdes,
                pin: pinNum,
                pinName: pinName,
                oldNet: oldNet || '—',
                newNet: newNet || '—',
                status: status
            });
        }

        return results;
    }

    return {
        compare: compare
    };
})();
