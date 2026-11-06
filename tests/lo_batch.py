"""Open a one-sheet .ods in a headless LibreOffice, recalculate it, and print column V of every row as JSON
({row id (column A): number | 'ERR:code'}). Used by the FormulaBase tests; see boot.php odsBatch()."""
import json, os, subprocess, sys, time, uno
from com.sun.star.beans import PropertyValue
from com.sun.star.table.CellContentType import TEXT
path, profile, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]), sys.argv[3]
pipe = 'fbbatch%d' % os.getpid()
proc = subprocess.Popen(['soffice', '--headless', '--invisible', '--norestore', '--nologo', '-env:UserInstallation=file://' + profile,
                         '--accept=pipe,name=%s;urp;' % pipe], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    ctx = None
    for _ in range(120):
        try:
            ctx = resolver.resolve('uno:pipe,name=%s;urp;StarOffice.ComponentContext' % pipe)
            break
        except Exception:
            time.sleep(0.5)
    desktop = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
    p = PropertyValue(); p.Name = 'Hidden'; p.Value = True
    doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(path), '_blank', 0, (p,))
    doc.calculateAll()
    sh = doc.Sheets.getByIndex(0)
    cur = sh.createCursor(); cur.gotoEndOfUsedArea(False)
    n = cur.RangeAddress.EndRow + 1
    data = sh.getCellRangeByPosition(0, 0, 21, n - 1).getDataArray()
    res = {}
    for y in range(n):
        cid = int(data[y][0]); c = sh.getCellByPosition(21, y)
        if c.getFormula() == '':
            res[cid] = 'NOFORMULA'
        elif c.getError() != 0:
            res[cid] = 'ERR:%d' % c.getError()
        else:
            res[cid] = c.getString() if c.Type == TEXT else c.getValue()
    json.dump(res, open(out, 'w'))
    doc.close(True)
finally:
    proc.terminate()
    try:
        proc.wait(10)
    except Exception:
        proc.kill()
