' Batch-export every *.idw under a folder to PDF (flat output folder).
' Run: cscript //nologo batch_export_drawings_pdf.vbs
'       cscript //nologo batch_export_drawings_pdf.vbs overwrite
'       cscript //nologo batch_export_drawings_pdf.vbs showui
'
' Skips subfolders named OldVersions (same idea as batch_part_drawings.vbs).
' PDFs use Save Copy As (True) like other Inventor PDF exports in this repo.

Dim DRAWINGS_ROOT
Dim PDF_OUTPUT_FOLDER
Dim INVENTOR_PROJECT
Dim ALLOW_SCAN_OLDVERSIONS

' ----- Edit if your paths differ -----
DRAWINGS_ROOT = "C:\Users\Micha\Desktop\Canadian Cladding\DRAWINGS & MODELS\Z Bars"
PDF_OUTPUT_FOLDER = "C:\Users\Micha\Desktop\Canadian Cladding\DRAWINGS & MODELS\Z Bars\PDF"
INVENTOR_PROJECT = ""
' True = recurse into OldVersions (not recommended).
ALLOW_SCAN_OLDVERSIONS = False
' -------------------------------------

Dim gOverwritePdf, gShowUi
Dim gOk, gSkipExists, gSkipOpenFail, gSkipOldVersions

gOverwritePdf = False
gShowUi = False
gOk = 0
gSkipExists = 0
gSkipOpenFail = 0
gSkipOldVersions = 0

Sub Fail(msg)
  WScript.Echo "FAIL " & msg & ": " & Err.Number & " " & Err.Description
  WScript.Quit 1
End Sub

Function IsOldVersionsFolderName(folderName)
  IsOldVersionsFolderName = (LCase(Trim(folderName)) = "oldversions")
End Function

Sub EnsureFolder(fso, folderPath)
  On Error Resume Next
  If folderPath = "" Then Exit Sub
  If Not fso.FolderExists(folderPath) Then fso.CreateFolder folderPath
  Err.Clear
End Sub

Sub RestoreInventorUi(inv)
  On Error Resume Next
  If inv Is Nothing Then Exit Sub
  inv.Visible = True
  inv.SilentOperation = False
  inv.UserInterfaceManager.UserInteractionDisabled = False
  Err.Clear
End Sub

Sub SetSilent(inv, wantSilent)
  On Error Resume Next
  If inv Is Nothing Then Exit Sub
  If gShowUi Then Exit Sub
  If wantSilent Then
    inv.SilentOperation = True
    inv.UserInterfaceManager.UserInteractionDisabled = True
  Else
    inv.SilentOperation = False
    inv.UserInterfaceManager.UserInteractionDisabled = False
  End If
  Err.Clear
End Sub

Function FirstIpjInFolder(fso, folderPath)
  Dim folder, fl
  FirstIpjInFolder = ""
  On Error Resume Next
  Set folder = fso.GetFolder(folderPath)
  For Each fl In folder.Files
    If LCase(fso.GetExtensionName(fl.Name)) = "ipj" Then
      FirstIpjInFolder = fl.Path
      Exit Function
    End If
  Next
End Function

Sub MaybeActivateProject(inv, fso)
  Dim ipj, adp, prjDoc
  ipj = Trim(INVENTOR_PROJECT)
  If Len(ipj) = 0 Then Exit Sub
  If Not fso.FileExists(ipj) Then
    WScript.Echo "WARN: INVENTOR_PROJECT not found: " & ipj
    Exit Sub
  End If
  On Error Resume Next
  adp = ""
  adp = inv.DesignProjectManager.ActiveDesignProject.FullFileName
  Err.Clear
  If LCase(Replace(adp, "/", "\")) = LCase(Replace(ipj, "/", "\")) Then
    WScript.Echo "OK   Project already active: " & ipj
    Exit Sub
  End If

  Call inv.DesignProjectManager.DesignProjects.Open(ipj, True)
  If Err.Number = 0 Then
    WScript.Echo "OK   Activated project (DesignProjects.Open): " & ipj
    Err.Clear
    Exit Sub
  End If
  Err.Clear

  Call inv.DesignProjectManager.DesignProjects.Open(ipj)
  If Err.Number = 0 Then
    WScript.Echo "OK   Activated project (Open 1-arg): " & ipj
    Err.Clear
    Exit Sub
  End If
  Err.Clear

  inv.DesignProjectManager.Open ipj, True
  If Err.Number = 0 Then
    WScript.Echo "OK   Activated project (DesignProjectManager.Open): " & ipj
    Err.Clear
    Exit Sub
  End If
  Err.Clear

  Set prjDoc = inv.Documents.Open(ipj, True)
  If Err.Number = 0 Then
    WScript.Echo "OK   Opened project (Documents.Open .ipj): " & ipj
    Err.Clear
    Exit Sub
  End If
  WScript.Echo "WARN: Could not activate project: " & Err.Number & " " & Err.Description
  Err.Clear
End Sub

Sub ProcessIdw(inv, idwPath, fso)
  Dim drawDoc, pdfPath, baseName, en, ed
  On Error Resume Next
  baseName = fso.GetBaseName(idwPath)
  pdfPath = fso.BuildPath(PDF_OUTPUT_FOLDER, baseName & ".pdf")

  If fso.FileExists(pdfPath) And Not gOverwritePdf Then
    gSkipExists = gSkipExists + 1
    WScript.Echo "SKIP exists: " & pdfPath
    Exit Sub
  End If

  Set drawDoc = inv.Documents.Open(idwPath, False)
  If Err.Number <> 0 Or drawDoc Is Nothing Then
    WScript.Echo "SKIP open: " & idwPath & " — " & Err.Number & " " & Err.Description
    Err.Clear
    gSkipOpenFail = gSkipOpenFail + 1
    Exit Sub
  End If

  drawDoc.Activate
  Err.Clear
  drawDoc.Update2 True
  Err.Clear

  drawDoc.SaveAs pdfPath, True
  If Err.Number <> 0 Then
    en = Err.Number
    ed = Err.Description
    Err.Clear
    drawDoc.SaveAs pdfPath, False
    If Err.Number <> 0 Then
      WScript.Echo "FAIL PDF: " & idwPath & " -> " & pdfPath & " — " & en & " " & ed & " / retry " & Err.Number & " " & Err.Description
      Err.Clear
      drawDoc.Close False
      Err.Clear
      Exit Sub
    End If
  End If

  drawDoc.Close False
  Err.Clear
  gOk = gOk + 1
  WScript.Echo "OK   " & pdfPath
End Sub

Sub BatchFolder(inv, folderPath, fso)
  Dim folder, f, sf
  On Error Resume Next
  Set folder = fso.GetFolder(folderPath)
  For Each f In folder.Files
    If LCase(fso.GetExtensionName(f.Name)) = "idw" Then
      If (Not ALLOW_SCAN_OLDVERSIONS) And IsOldVersionsFolderName(fso.GetFileName(fso.GetParentFolderName(f.Path))) Then
        gSkipOldVersions = gSkipOldVersions + 1
        WScript.Echo "SKIP OldVersions: " & f.Path
      Else
        ProcessIdw inv, f.Path, fso
      End If
    End If
  Next
  For Each sf In folder.SubFolders
    If ALLOW_SCAN_OLDVERSIONS Or Not IsOldVersionsFolderName(sf.Name) Then
      BatchFolder inv, sf.Path, fso
    End If
  Next
End Sub

Dim ai, arg, fso, inv, ipjAuto

For ai = 0 To WScript.Arguments.Count - 1
  arg = LCase(Trim(WScript.Arguments(ai)))
  If arg = "overwrite" Or arg = "/overwrite" Then gOverwritePdf = True
  If arg = "showui" Or arg = "/showui" Then gShowUi = True
Next

Set fso = CreateObject("Scripting.FileSystemObject")
If Not fso.FolderExists(DRAWINGS_ROOT) Then
  WScript.Echo "DRAWINGS_ROOT not found: " & DRAWINGS_ROOT
  WScript.Quit 1
End If

EnsureFolder fso, PDF_OUTPUT_FOLDER
If Not fso.FolderExists(PDF_OUTPUT_FOLDER) Then
  WScript.Echo "Could not create PDF folder: " & PDF_OUTPUT_FOLDER
  WScript.Quit 1
End If

If Len(Trim(INVENTOR_PROJECT)) = 0 Then
  ipjAuto = FirstIpjInFolder(fso, DRAWINGS_ROOT)
  If Len(ipjAuto) > 0 Then
    INVENTOR_PROJECT = ipjAuto
    WScript.Echo "Using project file in scan folder: " & INVENTOR_PROJECT
  End If
End If

WScript.Echo "Batch PDF export"
WScript.Echo "Scan:  " & DRAWINGS_ROOT
WScript.Echo "PDFs:  " & PDF_OUTPUT_FOLDER
If gOverwritePdf Then
  WScript.Echo "Mode:  overwrite existing PDFs"
Else
  WScript.Echo "Mode:  skip if PDF already exists (add overwrite to replace)"
End If
If gShowUi Then WScript.Echo "Mode:  showui (ribbon on; slower)"

On Error Resume Next
Set inv = CreateObject("Inventor.Application")
If Err.Number <> 0 Then Fail("CreateObject(Inventor.Application)")
inv.Visible = True
RestoreInventorUi inv
SetSilent inv, True

MaybeActivateProject inv, fso

BatchFolder inv, DRAWINGS_ROOT, fso

RestoreInventorUi inv
WScript.Echo "Summary: OK=" & gOk & "  SKIP exists=" & gSkipExists & "  SKIP open fail=" & gSkipOpenFail & "  SKIP OldVersions .idw=" & gSkipOldVersions
WScript.Echo "DONE"
