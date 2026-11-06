"""Open a document in a headless LibreOffice, recalculate it, print the last sheet's used
cells (or, for a text document, that it opened) as JSON. Used by the FormulaBase tests."""
import json, os, subprocess, sys, time, uno
from com.sun.star.beans import PropertyValue

path, profile = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
pipe = 'fbtest%d' % os.getpid()
proc = subprocess.Popen(['soffice', '--headless', '--invisible', '--norestore', '--nologo',
                         '-env:UserInstallation=file://' + profile,
                         '--accept=pipe,name=%s;urp;' % pipe],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    ctx = None
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    for _ in range(120):
        try:
            ctx = resolver.resolve('uno:pipe,name=%s;urp;StarOffice.ComponentContext' % pipe)
            break
        except Exception:
            time.sleep(0.5)
    if ctx is None:
        print(json.dumps({'error': 'LibreOffice did not start'})); sys.exit(0)
    desktop = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
    p = PropertyValue(); p.Name = 'Hidden'; p.Value = True
    r = PropertyValue(); r.Name = 'RepairPackage'; r.Value = False
    try:
        doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(path), '_blank', 0, (p, r))
    except Exception as e:
        print(json.dumps({'error': 'cannot open: %s' % e})); sys.exit(0)
    if doc is None:
        print(json.dumps({'error': 'cannot open'})); sys.exit(0)
    if not hasattr(doc, 'Sheets'):
        print(json.dumps({'opened': True, 'text': doc.getText().getString()}))
        doc.close(True); sys.exit(0)
    doc.calculateAll()
    sheets = doc.Sheets
    sh = sheets.getByIndex(sheets.Count - 1)
    cur = sh.createCursor(); cur.gotoEndOfUsedArea(False)
    last_row, last_col = cur.RangeAddress.EndRow, cur.RangeAddress.EndColumn
    rows = []
    for y in range(0, min(last_row, 500) + 1):
        row = []
        for x in range(0, min(last_col, 5) + 1):
            c = sh.getCellByPosition(x, y)
            row.append(c.getString())
        rows.append(row)
    print(json.dumps({'rows': rows, 'lastRow': last_row + 1}))
    doc.close(True)
finally:
    proc.terminate()
    try:
        proc.wait(10)
    except Exception:
        proc.kill()
