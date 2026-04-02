' Inventor local-only automation test (no Shopify)
' Run: cscript //nologo inventor_local_test.vbs

Option Explicit

Dim partTemplate, drawingTemplate, outputRoot, modelOut, pdfOut
Dim L1, L2, A1, T1

' ----- Configure these paths/values -----
partTemplate = "C:\Users\Micha\Desktop\Canadian Cladding\TEMPLATE FILES\L SHAPE TEMPLATE.ipt"
' Use a blank drawing template with no pre-placed views:
drawingTemplate = "C:\Users\Micha\Desktop\Canadian Cladding\TEMPLATE FILES\L SHAPE TEMPLATE.idw"
outputRoot = "C:\Users\Micha\Desktop\Canadian Cladding\DRAWINGS & MODELS"

L1 = 2.625
L2 = 1.0
A1 = 90
T1 = 0.0598
' ---------------------------------------

modelOut = outputRoot & "\MODELS\TEST-0001.ipt"
pdfOut = outputRoot & "\PDF\TEST-0001.pdf"

Sub Fail(stepName)
  WScript.Echo "FAIL " & stepName & ": " & Err.Number & " " & Err.Description
  WScript.Quit 1
End Sub

Function EnsureParentFolder(filePath)
  Dim fso, parent
  Set fso = CreateObject("Scripting.FileSystemObject")
  parent = fso.GetParentFolderName(filePath)
  If parent <> "" And Not fso.FolderExists(parent) Then
    fso.CreateFolder parent
  End If
End Function

On Error Resume Next

If partTemplate = "" Then
  WScript.Echo "FAIL CONFIG: partTemplate is empty"
  WScript.Quit 1
End If
If drawingTemplate = "" Then
  WScript.Echo "FAIL CONFIG: drawingTemplate is empty"
  WScript.Quit 1
End If

EnsureParentFolder modelOut
EnsureParentFolder pdfOut
If Err.Number <> 0 Then Fail("EnsureOutputFolders")

WScript.Echo "START Inventor local test"
WScript.Echo "Part template:    " & partTemplate
WScript.Echo "Drawing template: " & drawingTemplate
WScript.Echo "Model output:     " & modelOut
WScript.Echo "PDF output:       " & pdfOut

Dim inv
Set inv = CreateObject("Inventor.Application")
If Err.Number <> 0 Then Fail("CreateObject(Inventor.Application)")
inv.Visible = False
inv.SilentOperation = True
WScript.Echo "OK   Launch Inventor"

Dim partDoc, compDef, prm
Set partDoc = inv.Documents.Open(partTemplate, True)
If Err.Number <> 0 Then Fail("Open Part Template")
WScript.Echo "OK   Open Part Template"

Set compDef = partDoc.ComponentDefinition
If Err.Number <> 0 Then Fail("ComponentDefinition")
Set prm = compDef.Parameters
If Err.Number <> 0 Then Fail("Parameters")

prm.Item("L1").Expression = CStr(L1)
If Err.Number <> 0 Then Fail("Set L1")
prm.Item("L2").Expression = CStr(L2)
If Err.Number <> 0 Then Fail("Set L2")
prm.Item("A1").Expression = CStr(A1)
If Err.Number <> 0 Then Fail("Set A1")
prm.Item("T1").Expression = CStr(T1)
If Err.Number <> 0 Then Fail("Set T1")
WScript.Echo "OK   Set Parameters"

partDoc.SaveAs modelOut, False
If Err.Number <> 0 Then Fail("SaveAs Part")
partDoc.Close False
If Err.Number <> 0 Then Fail("Close Part")
WScript.Echo "OK   Save/Close Part"

Dim partForView, drawDoc, sheet, tg, pt, views
Dim oriVals, styleVals, i, j, ori, sty, addOk
Dim opts
Set partForView = inv.Documents.Open(modelOut, False)
If Err.Number <> 0 Then Fail("Open Saved Part For View")

Set drawDoc = inv.Documents.Add(12292, drawingTemplate, False) ' kDrawingDocumentObject
If Err.Number <> 0 Then Fail("Add Drawing Document")
WScript.Echo "OK   Create Drawing"

Set sheet = drawDoc.Sheets.Item(1)
If Err.Number <> 0 Then Fail("Get First Sheet")
Set tg = inv.TransientGeometry
If Err.Number <> 0 Then Fail("TransientGeometry")
Set pt = tg.CreatePoint2d(2.0, 2.0)
If Err.Number <> 0 Then Fail("CreatePoint2d")
Set views = sheet.DrawingViews
If Err.Number <> 0 Then Fail("DrawingViews")

' Additional options can be required for sheet metal parts
Set opts = inv.TransientObjects.CreateNameValueMap
If Err.Number <> 0 Then Fail("CreateNameValueMap")

' Try a few orientation/style enum combinations and report what works
oriVals = Array(12320, 12288, 12321, 12322, 12323)  ' front/current/top/right/left (common)
styleVals = Array(16400, 16401, 16402, 16403)       ' hidden/hidden removed/shaded/shaded hidden
addOk = False

For i = 0 To UBound(oriVals)
  For j = 0 To UBound(styleVals)
    Err.Clear
    ori = oriVals(i)
    sty = styleVals(j)
    ' First try with folded sheet metal option
    Call opts.Clear
    Call opts.Add("SheetMetalFoldedModel", True)
    Call views.AddBaseView(partForView, pt, 1.0, ori, sty, "", Empty, opts)
    If Err.Number = 0 Then
      WScript.Echo "OK   Add Base View folded (orientation=" & ori & ", style=" & sty & ")"
      addOk = True
      Exit For
    Else
      WScript.Echo "TRY  AddBaseView folded failed (orientation=" & ori & ", style=" & sty & "): " & Err.Number & " " & Err.Description
      Err.Clear
      ' Then try with unfolded
      Call opts.Clear
      Call opts.Add("SheetMetalFoldedModel", False)
      Call views.AddBaseView(partForView, pt, 1.0, ori, sty, "", Empty, opts)
      If Err.Number = 0 Then
        WScript.Echo "OK   Add Base View unfolded (orientation=" & ori & ", style=" & sty & ")"
        addOk = True
        Exit For
      Else
        WScript.Echo "TRY  AddBaseView unfolded failed (orientation=" & ori & ", style=" & sty & "): " & Err.Number & " " & Err.Description
      End If
    End If
  Next
  If addOk Then Exit For
Next

If Not addOk Then Fail("AddBaseView")

partForView.Close False
If Err.Number <> 0 Then Fail("Close PartForView")

drawDoc.SaveAs pdfOut, True
If Err.Number <> 0 Then Fail("SaveAs PDF")
drawDoc.Close False
If Err.Number <> 0 Then Fail("Close Drawing")
WScript.Echo "OK   Export PDF"

WScript.Echo "DONE Success"
WScript.Quit 0
