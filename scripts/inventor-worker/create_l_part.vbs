' Create L-shape part and export to PDF. Invoked by inventor_driver.py
' Usage: cscript //nologo create_l_part.vbs templatePath partPath drawTplPath pdfPath l1 l2 a1 gauge thickness
If WScript.Arguments.Count < 9 Then
  WScript.Echo "Expected 9 arguments, got " & WScript.Arguments.Count & ". Usage: create_l_part.vbs templatePath partPath drawTplPath pdfPath l1 l2 a1 gauge thickness"
  WScript.Quit 1
End If
templatePath = WScript.Arguments(0)
partPath = WScript.Arguments(1)
drawTplPath = WScript.Arguments(2)
pdfPath = WScript.Arguments(3)
l1 = CDbl(WScript.Arguments(4))
l2 = CDbl(WScript.Arguments(5))
a1 = CDbl(WScript.Arguments(6))
gauge = CInt(WScript.Arguments(7))
thickness = CDbl(WScript.Arguments(8))

On Error Resume Next
Set inv = CreateObject("Inventor.Application")
If Err.Number <> 0 Then
  WScript.Echo "Inventor not found"
  WScript.Quit 2
End If
On Error GoTo 0
inv.Visible = False
inv.SilentOperation = True

On Error Resume Next
Set partDoc = inv.Documents.Open(templatePath, True)
If Err.Number <> 0 Then WScript.Echo "1.Open: " & Err.Number & " " & Err.Description : WScript.Quit 3
Set compDef = partDoc.ComponentDefinition
Set oParams = compDef.Parameters
oParams.Item("L1").Expression = CStr(l1)
oParams.Item("L2").Expression = CStr(l2)
oParams.Item("A1").Expression = CStr(a1)
oParams.Item("T1").Expression = CStr(thickness)
If Err.Number <> 0 Then WScript.Echo "2.Params: " & Err.Number & " " & Err.Description : WScript.Quit 3
partDoc.SaveAs partPath, False
partDoc.Close False
If Err.Number <> 0 Then WScript.Echo "3.SaveAs: " & Err.Number & " " & Err.Description : WScript.Quit 3

Set partDocForView = inv.Documents.Open(partPath, False)
' Documents.Add: (DocType, TemplatePath) - some Inventor versions use 2 args only
Set drawDoc = inv.Documents.Add(12292, drawTplPath)
If Err.Number <> 0 Then WScript.Echo "4.AddDrawing: " & Err.Number & " " & Err.Description : WScript.Quit 3
Set sheet = drawDoc.Sheets.Item(1)
Set tg = inv.TransientGeometry
' Use fixed position (inches) - sheet center can fail on some templates
posX = 2.0
posY = 2.0
Set pos = tg.CreatePoint2d(posX, posY)
Set views = sheet.DrawingViews
' Use Call when method returns value; 12320=kFrontView 16400=kHiddenLine
Call views.AddBaseView(partDocForView, pos, 1.0, 12320, 16400)
If Err.Number <> 0 Then WScript.Echo "5.AddBaseView: " & Err.Number & " " & Err.Description : WScript.Quit 3
partDocForView.Close False
drawDoc.SaveAs pdfPath, True
drawDoc.Close False
If Err.Number <> 0 Then WScript.Echo "6.SavePdf: " & Err.Number & " " & Err.Description : WScript.Quit 3
WScript.Quit 0
