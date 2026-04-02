' Batch-create Inventor drawings for every part (.ipt) in a folder.
' Each drawing uses the same base name as the part and places one base view.
' Output extension matches the template (.dwg or .idw).
'
' Run: cscript //nologo batch_part_drawings.vbs
' Replace existing *.idw/*.dwg next to parts (required if you already have drawings): add overwrite to the command line:
'   cscript //nologo batch_part_drawings.vbs overwrite
'   (or /overwrite). Otherwise set OVERWRITE_EXISTING_DRAWINGS = True in this file.
' Inventor 2025: add nodim to skip iLogic/COM auto-dim (quiet batch). Add verbose for per-part AUTO-DIM lines.
'   cscript //nologo batch_part_drawings.vbs overwrite nodim
' Z-bar .ipt grid from a seed: cscript //nologo batch_generate_z_parts.vbs (then run this script for drawings).
' Z-bar parts named Z{gg}{ttttt}: before first drawing save, script sets part+drawing Summary Title + User Gauge (same as batch_generate / on-open rule).
' Diagnose (one part, verbose, may show Inventor dialogs): cscript //nologo batch_part_drawings.vbs diag
' Diagnose a specific file: cscript //nologo batch_part_drawings.vbs diag "C:\path\part.ipt"
' Note: After part diagnostics, "Creating new drawing..." can sit 1-3+ minutes (heavy templates).
'       If it seems stuck, switch to Inventor - a dialog may be waiting (Content Center, styles, etc.).
'
' Edit PARTS_FOLDER, optional VARIANTS_FOLDER, and DRAWING_TEMPLATE below.
' PARTS_FOLDER = Inventor project folder (e.g. Z Bars with ProjectName.ipj). VARIANTS_FOLDER = folder with ALL .ipt (if moved out of Z Bars); leave "" to scan PARTS_FOLDER only.
' If views always fail: set INVENTOR_PROJECT to your .ipj (or leave blank to auto-use first .ipj in scan folder, then PARTS_FOLDER).
' CC2026.dwg = Inventor DWG drawing template.
' If AddBaseView still fails: in Inventor open CC2026.dwg and Save Copy As CC2026.idw
' in the same folder - the script will use that .idw to place views and still save .dwg.
' If the template has a Base View but diag shows 0 views: Inventor Documents.Add can drop views;
' the script falls back to CopyFile + Documents.Open on the same template.
' Run without "diag" to batch-save *.<drawExt> next to each .ipt (recursive under PARTS_FOLDER). "diag" never SaveAs.
' Saving to .dwg/.pdf/.dxf is a translation: use SaveAs(..., True) first (Save Copy As). Plain SaveAs False often returns E_FAIL (-2147467259).
' Fallback: DWG translator SaveCopyAs; then .idw next to the part if DWG still fails.
' Recursive scan skips subfolders named OldVersions by default (drawings next to real .ipt, not backups).
' Set ALLOW_SCAN_OLDVERSIONS = True if your .ipt files only exist under OldVersions (not recommended long-term).
' If the template is .dwg but files end up as .idw, set OUTPUT_DRAWING_EXT = "idw" so the batch targets .idw
' and "skip if exists" matches your real files (otherwise the script looks for .dwg, never skips, and overwrites .idw).
' Set OVERWRITE_EXISTING_DRAWINGS = True only when you want to replace drawings (e.g. full regen; wipes manual dims).
' Auto-dimension (same family, small variations): set AUTO_DIMENSION_ILOGIC_RULE to an iLogic rule NAME embedded in the
' template .idw, OR to a base filename (no path) for scripts\inventor-worker\ilogic_rules\<name>.txt (RunExternalRule).
' RunExternalRule expects a rule FILE NAME (not a full path). VBScript cannot set iLogic ExternalRuleDirectories (COM
' String[]). The script copies ilogic_rules\<name>.txt next to the .ipt when missing so iLogic finds it via the project
' workspace; the temp copy is deleted after the run if this script created it.
' Inventor 2025: iLogic RunExternalRule/RunRule often fails from cscript (Err 5). The script also tries RunExternalRuleWithArguments,
' Sub-style calls, and for rule name CC_ZBar_AutoDimension a COM fallback: DrawingView.GetIntent + GeneralDimensions (usually fails from cscript; same D17/D18/D19 edge names as the rule file).
' The drawing is saved once before iLogic (unsaved drawings often yield RunExternalRule Err 5). A second save runs only
' if auto-dim reports success; after a failed RunExternalRule, Inventor often cannot Save again (Err 5 / E_FAIL).
' Implement dimensions inside that rule (named edges, DrawingCurves, model params). Leave blank to skip.
' Inventor 2025: add at least one Base View (placeholder .ipt) to the template - VBScript often cannot use
' ReferencedDocumentDescriptors.Add; the script relinks that view via FileDescriptor.ReplaceReference.

Option Explicit

Dim PARTS_FOLDER, VARIANTS_FOLDER, DRAWING_TEMPLATE, INVENTOR_PROJECT
PARTS_FOLDER = "C:\Users\Micha\Desktop\Canadian Cladding\DRAWINGS & MODELS\Z Bars"
' Full path in DOUBLE QUOTES (required). Ampersands in the path are OK inside the string.
' Example: VARIANTS_FOLDER = "C:\Users\Micha\Desktop\Canadian Cladding\DRAWINGS & MODELS\Z Bars\YourPartsFolder"
' Leave "" to scan PARTS_FOLDER only. Do not point at OldVersions\... (no production .ipt there; count will be 0).
VARIANTS_FOLDER = ""
' True = recurse into OldVersions (usually a bad idea). Backup .ipt files named Part.0007.ipt are always skipped.
Dim ALLOW_SCAN_OLDVERSIONS
ALLOW_SCAN_OLDVERSIONS = False
DRAWING_TEMPLATE = "C:\Users\Public\Documents\Autodesk\Inventor 2025\Templates\en-US\CC2026.dwg"
INVENTOR_PROJECT = ""

' "" = same extension as template. Set "idw" when DWG save fails so Save goes straight to *.idw (fewer errors in log).
Dim OUTPUT_DRAWING_EXT
OUTPUT_DRAWING_EXT = "idw"
' True = replace existing drawing files. False = skip parts that already have an output drawing (protects dimensions).
Dim OVERWRITE_EXISTING_DRAWINGS
OVERWRITE_EXISTING_DRAWINGS = True

' iLogic: embedded rule name in template, OR base name of ilogic_rules\<name>.txt (see header).
Dim AUTO_DIMENSION_ILOGIC_RULE
' External rule: scripts\inventor-worker\ilogic_rules\CC_ZBar_AutoDimension.txt — set "" to skip (recommended for Inventor 2025
' batch: iLogic RunExternalRule from cscript fails; DrawingView.GetIntent is iLogic-only and cannot run from VBScript).
Dim AUTO_DIMENSION_VERBOSE
AUTO_DIMENSION_VERBOSE = False
' True = print AUTO-DIM lines for every .ipt. False = one-time batch notes (useful for 100+ parts).
AUTO_DIMENSION_ILOGIC_RULE = "CC_ZBar_AutoDimension"

Const kDrawingDocumentObject = 12292
Const kFrontView = 12320
Const kHiddenLineDrawingViewStyle = 16400
' Z-bar edge names: see ilogic_rules\CC_ZBar_AutoDimension.txt (4 linears + 2 angulars; 8 unique intents).

Dim gLoggedBaseViewError
gLoggedBaseViewError = False

Dim gAutoDimNoILogicWarned
gAutoDimNoILogicWarned = False

Dim gBatchDrawingOk, gBatchSkipExists, gBatchSkipBackupIpt, gBatchSkipOldVersionsIpt
gBatchDrawingOk = 0
gBatchSkipExists = 0
gBatchSkipBackupIpt = 0
gBatchSkipOldVersionsIpt = 0

Dim gDiagMode
gDiagMode = False

Dim gOverwriteFromCmdLine
gOverwriteFromCmdLine = False

Dim gBatchNoAutoDim
gBatchNoAutoDim = False

Dim gAutoDimILogicUnavailable
gAutoDimILogicUnavailable = False

Dim gAutoDimComGetIntentUnavailable
gAutoDimComGetIntentUnavailable = False

Dim gAutoDimOnceQuietILogic
gAutoDimOnceQuietILogic = False

Dim gAutoDimOnceQuietCom
gAutoDimOnceQuietCom = False

Dim gAutoDimOnceQuietFirstSave
gAutoDimOnceQuietFirstSave = False

' When DRAWING_TEMPLATE is .dwg and a companion .idw is used for Documents.Add, this holds the .dwg path for a second create attempt.
Dim gDwgTemplatePath
gDwgTemplatePath = ""

' When using Copy+Open fallback, temp file path for DeleteTempDrawingWorkFile after Close.
Dim gTempDrawingWorkPath
gTempDrawingWorkPath = ""

' Inventor sometimes returns error 5 for Documents.Add(..., False); retry visible window or 2-arg overload.
Function CreateDrawingFromTemplate(inv, tplPath, errTag, ByRef lastErrNum, ByRef lastErrDesc)
  Dim d
  On Error Resume Next
  Set CreateDrawingFromTemplate = Nothing
  lastErrNum = 0
  lastErrDesc = ""
  If Len(Trim(tplPath)) = 0 Then Exit Function

  Err.Clear
  Set d = inv.Documents.Add(kDrawingDocumentObject, tplPath, False)
  If Err.Number = 0 Then
    Set CreateDrawingFromTemplate = d
    Exit Function
  End If
  lastErrNum = Err.Number
  lastErrDesc = Err.Description
  If Len(Trim(errTag)) > 0 Then WScript.Echo errTag & "TRY Documents.Add(visible=False): " & lastErrNum & " " & lastErrDesc
  Err.Clear

  Set d = inv.Documents.Add(kDrawingDocumentObject, tplPath, True)
  If Err.Number = 0 Then
    Set CreateDrawingFromTemplate = d
    Exit Function
  End If
  lastErrNum = Err.Number
  lastErrDesc = Err.Description
  If Len(Trim(errTag)) > 0 Then WScript.Echo errTag & "TRY Documents.Add(visible=True): " & lastErrNum & " " & lastErrDesc
  Err.Clear

  Set d = inv.Documents.Add(kDrawingDocumentObject, tplPath)
  If Err.Number = 0 Then
    Set CreateDrawingFromTemplate = d
    Exit Function
  End If
  lastErrNum = Err.Number
  lastErrDesc = Err.Description
  If Len(Trim(errTag)) > 0 Then WScript.Echo errTag & "TRY Documents.Add(2-arg): " & lastErrNum & " " & lastErrDesc
  Err.Clear
End Function

Sub DeleteTempDrawingWorkFile(fso)
  On Error Resume Next
  If Len(Trim(gTempDrawingWorkPath)) = 0 Then Exit Sub
  If fso.FileExists(gTempDrawingWorkPath) Then fso.DeleteFile gTempDrawingWorkPath
  gTempDrawingWorkPath = ""
  Err.Clear
End Sub

' Open a writable copy of the template (Documents.Add often yields DrawingViews.Count=0 on DWG-style templates).
Function OpenDrawingFromTemplateCopy(inv, sourceTplPath, fso, errTag, ByRef lastErrNum, ByRef lastErrDesc)
  Dim ext, tmpPath, d, stamp
  On Error Resume Next
  Set OpenDrawingFromTemplateCopy = Nothing
  lastErrNum = 0
  lastErrDesc = ""
  DeleteTempDrawingWorkFile fso
  ext = LCase(fso.GetExtensionName(sourceTplPath))
  If ext <> "idw" And ext <> "dwg" Then ext = "idw"
  stamp = Year(Now) & Month(Now) & Day(Now) & Hour(Now) & Minute(Now) & Second(Now) & "_" & CLng(Timer * 1000000)
  tmpPath = fso.BuildPath(fso.GetSpecialFolder(2), "inv_tpl_" & stamp & "." & ext)
  Err.Clear
  fso.CopyFile sourceTplPath, tmpPath, True
  If Err.Number <> 0 Then
    lastErrNum = Err.Number
    lastErrDesc = Err.Description
    If Len(Trim(errTag)) > 0 Then WScript.Echo errTag & "CopyFile template to temp failed: " & lastErrNum & " " & lastErrDesc
    Exit Function
  End If
  gTempDrawingWorkPath = tmpPath
  Err.Clear
  Set d = inv.Documents.Open(tmpPath, False)
  If Err.Number <> 0 Then
    lastErrNum = Err.Number
    lastErrDesc = Err.Description
    If Len(Trim(errTag)) > 0 Then WScript.Echo errTag & "Documents.Open(temp template) failed: " & lastErrNum & " " & lastErrDesc
    DeleteTempDrawingWorkFile fso
    Exit Function
  End If
  Set OpenDrawingFromTemplateCopy = d
End Function

' Prefer Documents.Add; if new drawing has no sheet views, use Copy+Open so template Base Views survive.
Function GetOrCreateDrawingFromTemplate(inv, tplPath, fso, errTag, ByRef lastErrNum, ByRef lastErrDesc)
  Dim d
  On Error Resume Next
  Set GetOrCreateDrawingFromTemplate = Nothing
  If Len(Trim(tplPath)) = 0 Then Exit Function
  If Not fso.FileExists(tplPath) Then
    lastErrNum = 53
    lastErrDesc = "Template not found"
    Exit Function
  End If

  DeleteTempDrawingWorkFile fso
  Set d = CreateDrawingFromTemplate(inv, tplPath, errTag, lastErrNum, lastErrDesc)
  If d Is Nothing Then Exit Function

  d.Activate
  Err.Clear
  WScript.Sleep 150
  If DrawingTotalViewCount(d) > 0 Then
    Set GetOrCreateDrawingFromTemplate = d
    Exit Function
  End If

  d.Close False
  Err.Clear
  If Len(Trim(errTag)) > 0 Then
    WScript.Echo errTag & "Documents.Add produced 0 DrawingViews; trying CopyFile + Documents.Open (same template)..."
  End If

  Set d = OpenDrawingFromTemplateCopy(inv, tplPath, fso, errTag, lastErrNum, lastErrDesc)
  If d Is Nothing Then Exit Function
  If Len(Trim(errTag)) > 0 Then
    WScript.Echo errTag & "After Copy+Open, total DrawingViews (all sheets)=" & DrawingTotalViewCount(d)
  End If
  Set GetOrCreateDrawingFromTemplate = d
End Function

Sub CloseDrawingDocCleanupTemp(drawDoc, fso)
  On Error Resume Next
  If Not drawDoc Is Nothing Then drawDoc.Close False
  DeleteTempDrawingWorkFile fso
  Err.Clear
End Sub

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
  WScript.Echo "TRY DesignProjects.Open: " & Err.Number & " " & Err.Description
  Err.Clear

  Call inv.DesignProjectManager.DesignProjects.Open(ipj)
  If Err.Number = 0 Then
    WScript.Echo "OK   Activated project (Open 1-arg): " & ipj
    Err.Clear
    Exit Sub
  End If
  WScript.Echo "TRY DesignProjects.Open 1-arg: " & Err.Number & " " & Err.Description
  Err.Clear

  On Error Resume Next
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
  WScript.Echo "WARN: Could not activate project (Inventor already had correct project?): " & Err.Number & " " & Err.Description
  Err.Clear
End Sub

Function FirstIptInFolder(fso, folderPath)
  Dim folder, fl
  FirstIptInFolder = ""
  On Error Resume Next
  Set folder = fso.GetFolder(folderPath)
  For Each fl In folder.Files
    If LCase(fso.GetExtensionName(fl.Name)) = "ipt" Then
      FirstIptInFolder = fl.Path
      Exit Function
    End If
  Next
End Function

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

Sub RestoreInventorUi(inv)
  On Error Resume Next
  If inv Is Nothing Then Exit Sub
  inv.Visible = True
  inv.SilentOperation = False
  inv.UserInterfaceManager.UserInteractionDisabled = False
  Err.Clear
End Sub

Function FindFallbackDrawingTemplate(fso, templatesFolder)
  Dim candidates, i, p
  FindFallbackDrawingTemplate = ""
  candidates = Array("Standard.idw", "Standard (mm).idw", "Standard (in).idw", "Standard (ANSI).idw")
  For i = 0 To UBound(candidates)
    p = fso.BuildPath(templatesFolder, candidates(i))
    If fso.FileExists(p) Then
      FindFallbackDrawingTemplate = p
      Exit Function
    End If
  Next
End Function

Sub EchoPartDiagnostics(partDoc)
  Dim cd, bc, dt, fp
  On Error Resume Next
  WScript.Echo "--- Part diagnostics ---"
  WScript.Echo "FullDocumentName: " & partDoc.FullDocumentName
  Err.Clear
  dt = partDoc.DocumentType
  WScript.Echo "DocumentType: " & dt & " (expect 12290 or similar for part)"
  Err.Clear
  Set cd = partDoc.ComponentDefinition
  If Err.Number <> 0 Then
    WScript.Echo "ComponentDefinition: ERR " & Err.Number & " " & Err.Description
    Err.Clear
    Exit Sub
  End If
  WScript.Echo "Has FlatPattern (sheet metal): " & PartHasFlatPattern(partDoc)
  Err.Clear
  bc = cd.SurfaceBodies.Count
  If Err.Number = 0 Then
    WScript.Echo "SurfaceBodies.Count: " & bc
  Else
    WScript.Echo "SurfaceBodies.Count: ERR " & Err.Number
    Err.Clear
  End If
  WScript.Echo "------------------------"
End Sub

' Link the .ipt to the drawing so AddBaseView / AddFlatPatternView have a resolved model.
' Inventor 2025: five-string ReferencedDocumentDescriptors.Add often 438 (late binding picks wrong overload).
' Prefer TransientObjects: FileDescriptor + CreateDocumentDescriptor + Add(single descriptor).
Sub LinkPartAsDrawingModel(inv, drawDoc, partDoc, tag)
  Dim desc, fn, fso, baseNm, fd, dd
  On Error Resume Next
  Set fso = CreateObject("Scripting.FileSystemObject")

  fn = ""
  Err.Clear
  fn = partDoc.FullFileName
  If Err.Number <> 0 Or Len(fn) = 0 Then
    Err.Clear
    fn = partDoc.FullDocumentName
  End If
  Err.Clear

  Err.Clear
  Set drawDoc.DefaultModel = partDoc
  If Err.Number = 0 Then
    If Len(Trim(tag)) > 0 Then WScript.Echo tag & "Linked: DefaultModel."
    Exit Sub
  End If
  Err.Clear

  ' DocumentDescriptor from open file (some builds expose this; avoids string overloads).
  If Len(fn) > 0 Then
    Err.Clear
    Set dd = inv.TransientObjects.CreateDocumentDescriptor(partDoc)
    If Err.Number = 0 And Not dd Is Nothing Then
      Err.Clear
      Set desc = drawDoc.ReferencedDocumentDescriptors.Add(dd)
      If Err.Number <> 0 Then
        Err.Clear
        drawDoc.ReferencedDocumentDescriptors.Add dd
      End If
      If Err.Number = 0 Then
        If Len(Trim(tag)) > 0 Then WScript.Echo tag & "Linked: Add(CreateDocumentDescriptor(part))."
        Exit Sub
      End If
      If Len(Trim(tag)) > 0 Then WScript.Echo tag & "TRY Add(dd from part): " & Err.Number & " " & Err.Description
      Err.Clear
    Else
      If Len(Trim(tag)) > 0 And Err.Number <> 0 Then WScript.Echo tag & "TRY CreateDocumentDescriptor(part): " & Err.Number & " " & Err.Description
      Err.Clear
    End If

    Err.Clear
    Set fd = inv.TransientObjects.CreateFileDescriptor
    If Err.Number = 0 And Not fd Is Nothing Then
      fd.FullFileName = fn
      Err.Clear
      Set dd = inv.TransientObjects.CreateDocumentDescriptor(fd)
      If Err.Number = 0 And Not dd Is Nothing Then
        Err.Clear
        Set desc = drawDoc.ReferencedDocumentDescriptors.Add(dd)
        If Err.Number <> 0 Then
          Err.Clear
          drawDoc.ReferencedDocumentDescriptors.Add dd
        End If
        If Err.Number = 0 Then
          If Len(Trim(tag)) > 0 Then WScript.Echo tag & "Linked: Add(CreateDocumentDescriptor(fileDesc))."
          Exit Sub
        End If
        If Len(Trim(tag)) > 0 Then WScript.Echo tag & "TRY Add(dd from file): " & Err.Number & " " & Err.Description
        Err.Clear
      Else
        If Len(Trim(tag)) > 0 And Err.Number <> 0 Then WScript.Echo tag & "TRY CreateDocumentDescriptor(fd): " & Err.Number & " " & Err.Description
        Err.Clear
      End If
    Else
      If Len(Trim(tag)) > 0 And Err.Number <> 0 Then WScript.Echo tag & "TRY CreateFileDescriptor: " & Err.Number & " " & Err.Description
      Err.Clear
    End If
  End If

  ' Add(ClientIdentifier, FullDocumentName, DisplayName, UniqueDocumentIdentifier, IsMonikerSource)
  If Len(fn) > 0 Then
    baseNm = fso.GetFileName(fn)
    Err.Clear
    Set desc = drawDoc.ReferencedDocumentDescriptors.Add("", fn, "", "", False)
    If Err.Number = 0 Then
      If Len(Trim(tag)) > 0 Then WScript.Echo tag & "Linked: ReferencedDocumentDescriptors.Add (minimal)."
      Exit Sub
    End If
    If Len(Trim(tag)) > 0 Then WScript.Echo tag & "TRY Add minimal: " & Err.Number & " " & Err.Description
    Err.Clear

    Set desc = drawDoc.ReferencedDocumentDescriptors.Add("", fn, baseNm, "", False)
    If Err.Number = 0 Then
      If Len(Trim(tag)) > 0 Then WScript.Echo tag & "Linked: ReferencedDocumentDescriptors.Add (with display name)."
      Exit Sub
    End If
    If Len(Trim(tag)) > 0 Then WScript.Echo tag & "TRY Add+display: " & Err.Number & " " & Err.Description
    Err.Clear

    Set desc = drawDoc.ReferencedDocumentDescriptors.Add("", fn, baseNm, "", True)
    If Err.Number = 0 Then
      If Len(Trim(tag)) > 0 Then WScript.Echo tag & "Linked: ReferencedDocumentDescriptors.Add (moniker True)."
      Exit Sub
    End If
    If Len(Trim(tag)) > 0 Then WScript.Echo tag & "TRY Add moniker True: " & Err.Number & " " & Err.Description
    Err.Clear
  End If

  Err.Clear
  Set desc = drawDoc.ReferencedDocumentDescriptors.CreateUsingDocument(partDoc)
  If Err.Number = 0 Then
    If Len(Trim(tag)) > 0 Then WScript.Echo tag & "Linked: CreateUsingDocument."
    Exit Sub
  End If
  If Len(Trim(tag)) > 0 Then WScript.Echo tag & "TRY CreateUsingDocument: " & Err.Number & " " & Err.Description
  Err.Clear

  If Len(fn) > 0 Then
    Err.Clear
    Set desc = drawDoc.ReferencedDocumentDescriptors.CreateUsingFullFileName(fn)
    If Err.Number = 0 Then
      If Len(Trim(tag)) > 0 Then WScript.Echo tag & "Linked: CreateUsingFullFileName."
      Exit Sub
    End If
    If Len(Trim(tag)) > 0 Then WScript.Echo tag & "TRY CreateUsingFullFileName: " & Err.Number & " " & Err.Description
    Err.Clear
    Set desc = drawDoc.ReferencedDocumentDescriptors.CreateUsingFileName(fn)
    If Err.Number = 0 Then
      If Len(Trim(tag)) > 0 Then WScript.Echo tag & "Linked: CreateUsingFileName."
      Exit Sub
    End If
    If Len(Trim(tag)) > 0 Then WScript.Echo tag & "TRY CreateUsingFileName: " & Err.Number & " " & Err.Description
    Err.Clear
  End If

  If Len(Trim(tag)) > 0 Then WScript.Echo tag & "WARN: Could not link part to drawing via API."
End Sub

' Point an existing template drawing view at the target .ipt/.iam (Inventor 2025: ReferencedDocumentDescriptors.Add often 438 from VBScript).
Function TryDrawingViewReplaceModelFile(v, fn, tag)
  Dim rdd, fd
  On Error Resume Next
  TryDrawingViewReplaceModelFile = False
  If v Is Nothing Or Len(fn) = 0 Then Exit Function

  Err.Clear
  Set rdd = v.ReferencedDocumentDescriptor
  If Err.Number = 0 And Not rdd Is Nothing Then
    Err.Clear
    Set fd = rdd.ReferencedFileDescriptor
    If Err.Number = 0 And Not fd Is Nothing Then
      Err.Clear
      fd.ReplaceReference fn
      If Err.Number = 0 Then
        If Len(Trim(tag)) > 0 Then WScript.Echo tag & "Linked: ReplaceReference (RDD.ReferencedFileDescriptor)."
        TryDrawingViewReplaceModelFile = True
        Exit Function
      End If
      If Len(Trim(tag)) > 0 Then WScript.Echo tag & "TRY ReplaceRef RDD.ReferencedFileDescriptor: " & Err.Number & " " & Err.Description
    End If
    Err.Clear
    Set fd = rdd.FileDescriptor
    If Err.Number = 0 And Not fd Is Nothing Then
      Err.Clear
      fd.ReplaceReference fn
      If Err.Number = 0 Then
        If Len(Trim(tag)) > 0 Then WScript.Echo tag & "Linked: ReplaceReference (RDD.FileDescriptor)."
        TryDrawingViewReplaceModelFile = True
        Exit Function
      End If
      If Len(Trim(tag)) > 0 Then WScript.Echo tag & "TRY ReplaceRef RDD.FileDescriptor: " & Err.Number & " " & Err.Description
    End If
  End If

  Err.Clear
  Set fd = v.ReferencedFileDescriptor
  If Err.Number = 0 And Not fd Is Nothing Then
    Err.Clear
    fd.ReplaceReference fn
    If Err.Number = 0 Then
      If Len(Trim(tag)) > 0 Then WScript.Echo tag & "Linked: ReplaceReference (View.ReferencedFileDescriptor)."
      TryDrawingViewReplaceModelFile = True
      Exit Function
    End If
    If Len(Trim(tag)) > 0 Then WScript.Echo tag & "TRY ReplaceRef View.ReferencedFileDescriptor: " & Err.Number & " " & Err.Description
  End If

  Err.Clear
  Set fd = v.FileDescriptor
  If Err.Number = 0 And Not fd Is Nothing Then
    Err.Clear
    fd.ReplaceReference fn
    If Err.Number = 0 Then
      If Len(Trim(tag)) > 0 Then WScript.Echo tag & "Linked: ReplaceReference (View.FileDescriptor)."
      TryDrawingViewReplaceModelFile = True
      Exit Function
    End If
    If Len(Trim(tag)) > 0 Then WScript.Echo tag & "TRY ReplaceRef View.FileDescriptor: " & Err.Number & " " & Err.Description
  End If
End Function

Function TryRelinkTemplateViewsToPart(drawDoc, fn, tag)
  Dim si, vi, sheet, v
  On Error Resume Next
  TryRelinkTemplateViewsToPart = False
  If drawDoc Is Nothing Or Len(fn) = 0 Then Exit Function
  For si = 1 To drawDoc.Sheets.Count
    Set sheet = drawDoc.Sheets.Item(si)
    For vi = 1 To sheet.DrawingViews.Count
      Set v = sheet.DrawingViews.Item(vi)
      If TryDrawingViewReplaceModelFile(v, fn, tag) Then
        TryRelinkTemplateViewsToPart = True
        Exit Function
      End If
    Next
  Next
End Function

Function DrawingTotalViewCount(drawDoc)
  Dim si, sheet, n
  On Error Resume Next
  n = 0
  For si = 1 To drawDoc.Sheets.Count
    Set sheet = drawDoc.Sheets.Item(si)
    n = n + sheet.DrawingViews.Count
  Next
  DrawingTotalViewCount = n
End Function

' Per-sheet view counts (diagnostics: template vs Update2 stripping views).
Sub EchoDrawingViewSnapshot(drawDoc, tag, stepLabel)
  Dim six, shx, tot
  On Error Resume Next
  If Len(Trim(tag)) = 0 Then tag = "DIAG: "
  tot = DrawingTotalViewCount(drawDoc)
  WScript.Echo tag & stepLabel & " total views (all sheets)=" & tot
  For six = 1 To drawDoc.Sheets.Count
    Set shx = drawDoc.Sheets.Item(six)
    WScript.Echo tag & "  sheet " & six & " name=""" & shx.Name & """ DrawingViews.Count=" & shx.DrawingViews.Count
  Next
End Sub

Sub ClearAllSheetsDrawingViewsUnlessRelinked(drawDoc, relinked)
  If relinked Then Exit Sub
  ClearAllSheetsDrawingViews drawDoc
End Sub

Sub EchoDrawingComProbe(drawDoc, tag)
  Dim cntRfd, dt
  On Error Resume Next
  If Len(Trim(tag)) = 0 Then tag = "DIAG: "
  Err.Clear
  dt = drawDoc.DocumentType
  If Err.Number = 0 Then
    WScript.Echo tag & "DrawingDocument.DocumentType: " & dt & " (expect " & kDrawingDocumentObject & " for drawing)"
  Else
    WScript.Echo tag & "DrawingDocument.DocumentType: ERR " & Err.Number
    Err.Clear
  End If
  cntRfd = drawDoc.File.ReferencedFileDescriptors.Count
  If Err.Number = 0 Then
    WScript.Echo tag & "DrawingDocument.File.ReferencedFileDescriptors.Count: " & cntRfd
  Else
    WScript.Echo tag & "DrawingDocument.File.ReferencedFileDescriptors: ERR " & Err.Number
    Err.Clear
  End If
  Dim sh1, dviews
  Err.Clear
  Set sh1 = drawDoc.Sheets.Item(1)
  Set dviews = sh1.DrawingViews
  If Err.Number = 0 Then
    WScript.Echo tag & "Sheet1.DrawingViews TypeName: " & TypeName(dviews)
  Else
    WScript.Echo tag & "Sheet1.DrawingViews: ERR " & Err.Number
    Err.Clear
  End If
End Sub

' First argument for DrawingViews.AddBaseView: prefer linked descriptor when collection has an entry.
Function ModelObjectForDrawingView(drawDoc, partDoc)
  On Error Resume Next
  If drawDoc.ReferencedDocumentDescriptors.Count >= 1 Then
    Set ModelObjectForDrawingView = drawDoc.ReferencedDocumentDescriptors.Item(1)
    If Err.Number = 0 Then Exit Function
    Err.Clear
  End If
  Set ModelObjectForDrawingView = partDoc
End Function

' Templates like CC2026 often include a placeholder base view -> "Select Component" + stuck UI.
Sub ClearSheetDrawingViews(sheet)
  Dim i
  On Error Resume Next
  For i = sheet.DrawingViews.Count To 1 Step -1
    sheet.DrawingViews.Item(i).Delete
  Next
End Sub

Sub ClearAllSheetsDrawingViews(drawDoc)
  Dim si
  On Error Resume Next
  For si = 1 To drawDoc.Sheets.Count
    ClearSheetDrawingViews drawDoc.Sheets.Item(si)
  Next
End Sub

Sub EchoDrawingSheetDiagnostics(drawDoc)
  Dim si, sheet, sw, sh
  On Error Resume Next
  WScript.Echo "--- Drawing diagnostics ---"
  WScript.Echo "Sheets.Count: " & drawDoc.Sheets.Count
  For si = 1 To drawDoc.Sheets.Count
    Set sheet = drawDoc.Sheets.Item(si)
    sw = sheet.Width
    sh = sheet.Height
    WScript.Echo "Sheet " & si & " name=" & sheet.Name & " W=" & sw & " H=" & sh & " views(before)=" & sheet.DrawingViews.Count
  Next
  WScript.Echo "-----------------------------"
End Sub

' Prefer 5-arg AddBaseView (Inventor 2025 often returns error 5 on 8-arg overload on drawing sheets).
Function TrySingleBaseView(views, drawDoc, partDoc, pt, ByRef lastErrNum, ByRef lastErrDesc)
  Dim oDv, mdl
  On Error Resume Next
  Set mdl = ModelObjectForDrawingView(drawDoc, partDoc)
  Err.Clear
  Set oDv = views.AddBaseView(mdl, pt, 1.0, kFrontView, kHiddenLineDrawingViewStyle, "")
  If Err.Number = 0 Then
    TrySingleBaseView = True
    Exit Function
  End If
  lastErrNum = Err.Number
  lastErrDesc = Err.Description
  Err.Clear
  Set oDv = views.AddBaseView(mdl, pt, 1.0, kFrontView, kHiddenLineDrawingViewStyle)
  If Err.Number = 0 Then
    TrySingleBaseView = True
    Exit Function
  End If
  lastErrNum = Err.Number
  lastErrDesc = Err.Description
  Err.Clear
  Set oDv = views.AddBaseView(mdl, pt, 1.0, kFrontView, kHiddenLineDrawingViewStyle, "", Nothing, Nothing)
  If Err.Number = 0 Then
    TrySingleBaseView = True
  Else
    lastErrNum = Err.Number
    lastErrDesc = Err.Description
    TrySingleBaseView = False
  End If
End Function

' Diag: flat pattern (sheet metal), 6/5-arg AddBaseView sweep, 8-arg fallback. (4-arg AddBaseView -> error 450 on Inventor 2025.)
Function TryDiagPlaceViews(inv, drawDoc, views, partDoc, pt, hasFlat, ByRef lastErrNum, ByRef lastErrDesc)
  Dim oDv, oriVals, styleVals, i, j, ori, sty, mdl, rdd
  On Error Resume Next
  lastErrNum = 0
  lastErrDesc = ""

  Set mdl = ModelObjectForDrawingView(drawDoc, partDoc)
  oriVals = Array(12320, 12321, 12322, 12323, 12288)
  styleVals = Array(16400, 16401, 16402, 16403)

  If hasFlat Then
    Err.Clear
    If TryFlatPatternView(views, partDoc, pt, 1.0, lastErrNum, lastErrDesc) Then
      WScript.Echo "DIAG OK: AddFlatPatternView (partDoc)."
      TryDiagPlaceViews = True
      Exit Function
    End If
    WScript.Echo "DIAG: AddFlatPatternView (partDoc) failed; last: " & lastErrNum & " " & lastErrDesc & " (438 = often not exposed to VBScript late binding)"
    Err.Clear
    Set rdd = drawDoc.ReferencedDocumentDescriptors
    If rdd.Count >= 1 Then
      If TryFlatPatternView(views, rdd.Item(1), pt, 1.0, lastErrNum, lastErrDesc) Then
        WScript.Echo "DIAG OK: AddFlatPatternView (descriptor)."
        TryDiagPlaceViews = True
        Exit Function
      End If
      WScript.Echo "DIAG: AddFlatPatternView (descriptor) failed; last: " & lastErrNum & " " & lastErrDesc
    End If
    Err.Clear
  End If
  For i = 0 To UBound(oriVals)
    For j = 0 To UBound(styleVals)
      ori = oriVals(i)
      sty = styleVals(j)
      Err.Clear
      Set oDv = views.AddBaseView(mdl, pt, 1.0, ori, sty, "")
      If Err.Number = 0 Then
        WScript.Echo "DIAG OK: AddBaseView 6-arg ori=" & ori & " style=" & sty
        TryDiagPlaceViews = True
        Exit Function
      End If
      lastErrNum = Err.Number
      lastErrDesc = Err.Description
      Err.Clear
      Set oDv = views.AddBaseView(mdl, pt, 1.0, ori, sty)
      If Err.Number = 0 Then
        WScript.Echo "DIAG OK: AddBaseView 5-arg ori=" & ori & " style=" & sty
        TryDiagPlaceViews = True
        Exit Function
      End If
      lastErrNum = Err.Number
      lastErrDesc = Err.Description
    Next
  Next
  WScript.Echo "DIAG: All 6-arg/5-arg AddBaseView tries failed; last: " & lastErrNum & " " & lastErrDesc
  TryDiagPlaceViews = TrySingleBaseView(views, drawDoc, partDoc, pt, lastErrNum, lastErrDesc)
  If TryDiagPlaceViews Then WScript.Echo "DIAG OK: AddBaseView 8-arg fallback."
End Function

' Link, optional ReplaceReference on template views, clear placeholders unless relinked, then place views or accept relinked views.
Function DiagPrepareAndPlaceViews(inv, drawDoc, partDoc, hasFlat, tag, ByRef lastErrNum, ByRef lastErrDesc)
  Dim fn, relinked, sheet, sw, sh, pt, views, tg
  On Error Resume Next
  DiagPrepareAndPlaceViews = False
  fn = partDoc.FullFileName
  If Err.Number <> 0 Or Len(fn) = 0 Then
    Err.Clear
    fn = partDoc.FullDocumentName
  End If
  Err.Clear

  EchoDrawingViewSnapshot drawDoc, tag, "STEP: Views BEFORE link / ReplaceReference / Update2 (if 0, the .idw on disk has no saved views, or wrong file): "
  EchoDrawingComProbe drawDoc, tag
  LinkPartAsDrawingModel inv, drawDoc, partDoc, tag
  Err.Clear
  relinked = TryRelinkTemplateViewsToPart(drawDoc, fn, tag)
  drawDoc.Update2 True
  Err.Clear

  EchoDrawingViewSnapshot drawDoc, tag, "STEP: Views AFTER link + ReplaceReference + Update2 (if this dropped to 0, fix template references): "
  EchoDrawingSheetDiagnostics drawDoc
  If DrawingTotalViewCount(drawDoc) = 0 Then
    WScript.Echo tag & "HINT: 0 views on new drawing. Batch uses the path shown as DIAG: Template (companion CC2026.idw). Open THAT .idw, place Base View, File > Save (same path). Saving only CC2026.dwg does not update the .idw the script uses."
    WScript.Echo tag & "HINT: VBScript often gets 438 on ReferencedDocumentDescriptors.Add / AddFlatPatternView (late binding). Placeholder view + ReplaceReference still needs views present here."
  End If

  ClearAllSheetsDrawingViewsUnlessRelinked drawDoc, relinked
  drawDoc.Update2 True
  Err.Clear
  If relinked Then WScript.Echo tag & "Kept template views (ReplaceReference ok)."

  Set sheet = drawDoc.Sheets.Item(1)
  sheet.Activate
  sw = sheet.Width
  sh = sheet.Height
  If sw <= 0 Or sh <= 0 Then
    sw = 25
    sh = 20
  End If
  Set tg = inv.TransientGeometry
  Set pt = tg.CreatePoint2d(sw * 0.5, sh * 0.5)
  Set views = sheet.DrawingViews

  WScript.Echo tag & "ReferencedDocumentDescriptors count: " & drawDoc.ReferencedDocumentDescriptors.Count
  WScript.Echo tag & "Total drawing views on all sheets: " & DrawingTotalViewCount(drawDoc)

  If relinked And DrawingTotalViewCount(drawDoc) > 0 Then
    DiagPrepareAndPlaceViews = True
    Exit Function
  End If

  WScript.Echo tag & "Placing base view (AddFlatPatternView / AddBaseView)..."
  DiagPrepareAndPlaceViews = TryDiagPlaceViews(inv, drawDoc, views, partDoc, pt, hasFlat, lastErrNum, lastErrDesc)
End Function

Sub RunDiagnostics(inv, partPath, tplPrimary, tplFolder, fso, tplAlternateDwg)
  Dim partDoc, drawDoc, lastErrNum, lastErrDesc, fbTpl
  Dim hasFlat
  Dim docErrNum, docErrDesc

  WScript.Echo "DIAG: Part: " & partPath
  WScript.Echo "DIAG: Template: " & tplPrimary

  On Error Resume Next
  inv.SilentOperation = True
  inv.UserInterfaceManager.UserInteractionDisabled = True
  Err.Clear

  Err.Clear
  WScript.Echo "Active design project: " & inv.DesignProjectManager.ActiveDesignProject.FullFileName
  Err.Clear

  Set partDoc = inv.Documents.Open(partPath, False)
  If Err.Number <> 0 Then
    WScript.Echo "DIAG FAIL: Open part - " & Err.Number & " " & Err.Description
    Exit Sub
  End If
  partDoc.Update2 True
  Err.Clear
  If PartHasFlatPattern(partDoc) Then
    partDoc.ComponentDefinition.FlatPattern.Update
    Err.Clear
  End If
  EchoPartDiagnostics partDoc
  hasFlat = PartHasFlatPattern(partDoc)

  WScript.Echo "DIAG: Creating drawing from template (can take 1-3 min on first load)..."
  If fso.FileExists(tplPrimary) Then
    WScript.Echo "DIAG: Template on disk (must Save Base View in this file): " & tplPrimary
    WScript.Echo "DIAG: Template DateLastModified: " & fso.GetFile(tplPrimary).DateLastModified & "  bytes=" & fso.GetFile(tplPrimary).Size
  Else
    WScript.Echo "DIAG: WARN: Template not found: " & tplPrimary
  End If
  Set drawDoc = GetOrCreateDrawingFromTemplate(inv, tplPrimary, fso, "DIAG: ", docErrNum, docErrDesc)
  If drawDoc Is Nothing Then
    WScript.Echo "DIAG FAIL: New drawing - " & docErrNum & " " & docErrDesc
    partDoc.Close False
    Exit Sub
  End If
  drawDoc.Activate
  Err.Clear

  If DiagPrepareAndPlaceViews(inv, drawDoc, partDoc, hasFlat, "DIAG: ", lastErrNum, lastErrDesc) Then
    WScript.Echo "DIAG OK: Drawing ok with primary template."
    CloseDrawingDocCleanupTemp drawDoc, fso
    partDoc.Close False
    Exit Sub
  End If
  WScript.Echo "DIAG FAIL primary template: " & lastErrNum & " " & lastErrDesc

  CloseDrawingDocCleanupTemp drawDoc, fso
  Err.Clear

  If Len(tplAlternateDwg) > 0 And LCase(Replace(tplAlternateDwg, "/", "\")) <> LCase(Replace(tplPrimary, "/", "\")) Then
    If fso.FileExists(tplAlternateDwg) Then
      WScript.Echo "DIAG: Retrying new drawing from .dwg template: " & tplAlternateDwg
      WScript.Echo "DIAG: .dwg template DateLastModified: " & fso.GetFile(tplAlternateDwg).DateLastModified
      Set drawDoc = GetOrCreateDrawingFromTemplate(inv, tplAlternateDwg, fso, "DIAG: ", docErrNum, docErrDesc)
      If Not drawDoc Is Nothing Then
        drawDoc.Activate
        Err.Clear
        If DiagPrepareAndPlaceViews(inv, drawDoc, partDoc, hasFlat, "DIAG: ", lastErrNum, lastErrDesc) Then
          WScript.Echo "DIAG OK: Drawing ok with .dwg template."
          CloseDrawingDocCleanupTemp drawDoc, fso
          partDoc.Close False
          Exit Sub
        End If
        WScript.Echo "DIAG FAIL .dwg template: " & lastErrNum & " " & lastErrDesc
        CloseDrawingDocCleanupTemp drawDoc, fso
        Err.Clear
      Else
        WScript.Echo "DIAG FAIL: New drawing from .dwg - " & docErrNum & " " & docErrDesc
        Err.Clear
      End If
    End If
  End If

  fbTpl = FindFallbackDrawingTemplate(fso, tplFolder)
  If Len(fbTpl) = 0 Then
    WScript.Echo "DIAG: No Standard*.idw fallback in: " & tplFolder
    WScript.Echo "DIAG: Leaving part open. Answer: Does Place Views > Base work manually for this part?"
    Exit Sub
  End If

  WScript.Echo "DIAG: Retrying with fallback template: " & fbTpl
  WScript.Echo "DIAG: Fallback template DateLastModified: " & fso.GetFile(fbTpl).DateLastModified
  Set drawDoc = GetOrCreateDrawingFromTemplate(inv, fbTpl, fso, "DIAG: ", docErrNum, docErrDesc)
  If drawDoc Is Nothing Then
    WScript.Echo "DIAG FAIL: Open fallback - " & docErrNum & " " & docErrDesc
    WScript.Echo "DIAG: Leaving part open."
    Exit Sub
  End If
  drawDoc.Activate
  Err.Clear
  If DiagPrepareAndPlaceViews(inv, drawDoc, partDoc, hasFlat, "DIAG: ", lastErrNum, lastErrDesc) Then
    WScript.Echo "DIAG OK: Drawing ok with Standard template."
    CloseDrawingDocCleanupTemp drawDoc, fso
    partDoc.Close False
    Exit Sub
  End If
  WScript.Echo "DIAG FAIL fallback: " & lastErrNum & " " & lastErrDesc
  WScript.Echo "DIAG: Leaving Inventor with part + failed drawing open. Close when done."
  WScript.Echo "DIAG: Please report: (1) Manual Base view works? (2) Active .ipj name (File > Manage Projects)."
End Sub

Sub Fail(msg)
  WScript.Echo "FAIL: " & msg & " - " & Err.Number & " " & Err.Description
  WScript.Quit 1
End Sub

Function FileExists(path)
  Dim fso
  Set fso = CreateObject("Scripting.FileSystemObject")
  FileExists = fso.FileExists(path)
End Function

' AddBaseView / AddFlatPatternView return a DrawingView. Using "Call" on these in VBScript
' often surfaces as E_FAIL (0x80004005); assign the return value instead.
Sub TryAddBaseViewOnce(views, modelObj, pt, scale, ori, sty, opts, ByRef lastErrNum, ByRef lastErrDesc)
  Dim oDv
  On Error Resume Next
  Err.Clear
  If opts Is Nothing Then
    Set oDv = views.AddBaseView(modelObj, pt, scale, ori, sty, "", Nothing, Nothing)
  Else
    Set oDv = views.AddBaseView(modelObj, pt, scale, ori, sty, "", Nothing, opts)
  End If
  If Err.Number <> 0 Then
    lastErrNum = Err.Number
    lastErrDesc = Err.Description
  End If
End Sub

Function PartHasFlatPattern(partDoc)
  On Error Resume Next
  Dim fp
  Set fp = partDoc.ComponentDefinition.FlatPattern
  PartHasFlatPattern = (Err.Number = 0)
End Function

Function TryFlatPatternView(views, partDoc, pt, scale, ByRef lastErrNum, ByRef lastErrDesc)
  Dim oDv, styVals, j, sty
  On Error Resume Next
  lastErrNum = 0
  lastErrDesc = ""
  styVals = Array(16400, 16401, 16402, 16403)
  For j = 0 To UBound(styVals)
    sty = styVals(j)
    Err.Clear
    Set oDv = views.AddFlatPatternView(partDoc, pt, scale, sty)
    If Err.Number = 0 Then
      TryFlatPatternView = True
      Exit Function
    End If
    lastErrNum = Err.Number
    lastErrDesc = Err.Description
    Err.Clear
    Set oDv = views.AddFlatPatternView(partDoc, pt, scale, sty, "", Nothing)
    If Err.Number = 0 Then
      TryFlatPatternView = True
      Exit Function
    End If
    lastErrNum = Err.Number
    lastErrDesc = Err.Description
  Next
  TryFlatPatternView = False
End Function

Function TryAddBaseView(views, drawDoc, partDoc, pt, inv, scale, ByRef lastErrNum, ByRef lastErrDesc)
  Dim opts, oriVals, styleVals, i, j, ori, sty, s, foldLoop, folded, oBv, mdl

  On Error Resume Next
  lastErrNum = 0
  lastErrDesc = ""

  Set mdl = ModelObjectForDrawingView(drawDoc, partDoc)

  oriVals = Array(12320, 12321, 12322, 12323, 12288)
  styleVals = Array(16400, 16401, 16402, 16403)

  ' Inventor 2025: 6-arg (view name "") then 5-arg; model may be PartDocument or linked DocumentDescriptor.
  For i = 0 To UBound(oriVals)
    For j = 0 To UBound(styleVals)
      ori = oriVals(i)
      sty = styleVals(j)
      Err.Clear
      Set oBv = views.AddBaseView(mdl, pt, scale, ori, sty, "")
      If Err.Number = 0 Then
        TryAddBaseView = True
        Exit Function
      End If
      lastErrNum = Err.Number
      lastErrDesc = Err.Description
      Err.Clear
      Set oBv = views.AddBaseView(mdl, pt, scale, ori, sty)
      If Err.Number = 0 Then
        TryAddBaseView = True
        Exit Function
      End If
      lastErrNum = Err.Number
      lastErrDesc = Err.Description
    Next
  Next

  For i = 0 To UBound(oriVals)
    For j = 0 To UBound(styleVals)
      ori = oriVals(i)
      sty = styleVals(j)
      TryAddBaseViewOnce views, mdl, pt, scale, ori, sty, Nothing, lastErrNum, lastErrDesc
      If Err.Number = 0 Then
        TryAddBaseView = True
        Exit Function
      End If
    Next
  Next

  Err.Clear
  Set opts = inv.TransientObjects.CreateNameValueMap
  If Err.Number = 0 Then
    For foldLoop = 1 To 2
      If foldLoop = 1 Then folded = True Else folded = False
      For i = 0 To UBound(oriVals)
        For j = 0 To UBound(styleVals)
          ori = oriVals(i)
          sty = styleVals(j)
          Err.Clear
          Call opts.Clear
          Call opts.Add("SheetMetalFoldedModel", folded)
          TryAddBaseViewOnce views, mdl, pt, scale, ori, sty, opts, lastErrNum, lastErrDesc
          If Err.Number = 0 Then
            TryAddBaseView = True
            Exit Function
          End If
        Next
      Next
    Next
  End If

  For Each s In Array(0.5, 0.25, 0.1, 0.05)
    Err.Clear
    Set oBv = views.AddBaseView(mdl, pt, s, kFrontView, kHiddenLineDrawingViewStyle)
    If Err.Number = 0 Then
      TryAddBaseView = True
      Exit Function
    End If
    lastErrNum = Err.Number
    lastErrDesc = Err.Description
    TryAddBaseViewOnce views, mdl, pt, s, kFrontView, kHiddenLineDrawingViewStyle, Nothing, lastErrNum, lastErrDesc
    If Err.Number = 0 Then
      TryAddBaseView = True
      Exit Function
    End If
  Next

  TryAddBaseView = False
End Function

Sub BatchLinkAndClearViews(inv, drawDoc, partDoc, fn, ByRef relinked)
  On Error Resume Next
  LinkPartAsDrawingModel inv, drawDoc, partDoc, ""
  Err.Clear
  relinked = TryRelinkTemplateViewsToPart(drawDoc, fn, "")
  drawDoc.Update2 True
  Err.Clear
  ClearAllSheetsDrawingViewsUnlessRelinked drawDoc, relinked
  drawDoc.Update2 True
  Err.Clear
End Sub

' After BatchLinkAndClearViews: try flat pattern + base views on every sheet (unless caller already has views from ReplaceReference).
Sub AttemptPlaceViewsOnDrawing(inv, drawDoc, partDoc, hasFp, ByRef placed, ByRef lastErrNum, ByRef lastErrDesc)
  Dim tg, sheet, si, views, sw, sh, pt, fxArr, fyArr, fi, scArr, sci, tryScale
  On Error Resume Next
  placed = False
  lastErrNum = 0
  lastErrDesc = ""
  Set tg = inv.TransientGeometry

  fxArr = Array(0.5, 0.35, 0.5, 0.25, 0.65, 0.45)
  fyArr = Array(0.5, 0.55, 0.72, 0.62, 0.48, 0.38)
  scArr = Array(1.0, 0.5, 0.25, 0.1)

  For si = 1 To drawDoc.Sheets.Count
    Set sheet = drawDoc.Sheets.Item(si)
    sheet.Activate
    Err.Clear
    sw = sheet.Width
    If Err.Number <> 0 Then sw = 0
    Err.Clear
    sh = sheet.Height
    If Err.Number <> 0 Then sh = 0
    Err.Clear
    If sw <= 0 Or sh <= 0 Then
      sw = 25
      sh = 20
    End If
    Set views = sheet.DrawingViews
    For sci = 0 To UBound(scArr)
      tryScale = scArr(sci)
      For fi = 0 To UBound(fxArr)
        Set pt = tg.CreatePoint2d(sw * fxArr(fi), sh * fyArr(fi))
        If hasFp Then
          If TryFlatPatternView(views, partDoc, pt, tryScale, lastErrNum, lastErrDesc) Then
            placed = True
            Exit For
          End If
          Err.Clear
          If drawDoc.ReferencedDocumentDescriptors.Count >= 1 Then
            If TryFlatPatternView(views, drawDoc.ReferencedDocumentDescriptors.Item(1), pt, tryScale, lastErrNum, lastErrDesc) Then
              placed = True
              Exit For
            End If
          End If
          Err.Clear
        End If
        If TryAddBaseView(views, drawDoc, partDoc, pt, inv, tryScale, lastErrNum, lastErrDesc) Then
          placed = True
          Exit For
        End If
      Next
      If placed Then Exit For
    Next
    If placed Then Exit For
  Next
End Sub

' DWG export add-in (Inventor; same id across many versions). If ItemById fails, translator fallback is skipped.
Const kDwgTranslatorAddInId = "{C24E3AC2-122E-11D5-8E91-0010B541CD80}"
' IoMechanismEnum.kFileBrowseIOMechanism — try others if SaveCopyAs still fails on your build.
Const kIoMechanism_FileBrowse = 12290

Function SaveDrawingViaDwgTranslator(inv, drawDoc, dwgFullPath, fso)
  Dim addIn, ctx, opts, med, tArr, ti, t
  On Error Resume Next
  SaveDrawingViaDwgTranslator = False
  Set addIn = inv.ApplicationAddIns.ItemById(kDwgTranslatorAddInId)
  If addIn Is Nothing Then Exit Function
  If addIn.Enabled = False Then addIn.Enabled = True
  Err.Clear
  If fso.FileExists(dwgFullPath) Then fso.DeleteFile dwgFullPath, True
  Err.Clear
  tArr = Array(kIoMechanism_FileBrowse, 12291, 12289, 12288, 12292, 12293, 1)
  For ti = 0 To UBound(tArr)
    t = tArr(ti)
    Err.Clear
    Set ctx = inv.TransientObjects.CreateTranslationContext
    If Err.Number <> 0 Then Exit Function
    ctx.Type = t
    Err.Clear
    Set opts = inv.TransientObjects.CreateNameValueMap
    If Err.Number <> 0 Then Exit Function
    addIn.HasSaveCopyAsOptions drawDoc, ctx, opts
    Err.Clear
    Set med = inv.TransientObjects.CreateDataMedium
    If Err.Number <> 0 Then Exit Function
    med.FileName = dwgFullPath
    Err.Clear
    addIn.SaveCopyAs drawDoc, ctx, opts, med
    If Err.Number = 0 And fso.FileExists(dwgFullPath) Then
      SaveDrawingViaDwgTranslator = True
      Exit Function
    End If
  Next
End Function

' Writes desiredOutPath when possible. For translated types (.dwg, .pdf, .dxf), tries Save Copy As (True) first.
Function SaveDrawingDocument(inv, drawDoc, desiredOutPath, fso, ByRef savedOutPath, ByRef errNum, ByRef errDesc)
  Dim ext, idwAlt
  On Error Resume Next
  SaveDrawingDocument = False
  savedOutPath = ""
  errNum = 0
  errDesc = ""
  ext = LCase(fso.GetExtensionName(desiredOutPath))

  If fso.FileExists(desiredOutPath) Then
    fso.DeleteFile desiredOutPath, True
    Err.Clear
  End If

  drawDoc.Update2 True
  Err.Clear

  If ext = "dwg" Or ext = "pdf" Or ext = "dxf" Then
    drawDoc.SaveAs desiredOutPath, True
  Else
    drawDoc.SaveAs desiredOutPath, False
  End If
  If Err.Number = 0 Then
    savedOutPath = desiredOutPath
    SaveDrawingDocument = True
    Exit Function
  End If
  errNum = Err.Number
  errDesc = Err.Description
  Err.Clear

  If ext = "dwg" Or ext = "pdf" Or ext = "dxf" Then
    drawDoc.SaveAs desiredOutPath, False
  Else
    drawDoc.SaveAs desiredOutPath, True
  End If
  If Err.Number = 0 Then
    savedOutPath = desiredOutPath
    SaveDrawingDocument = True
    Exit Function
  End If
  errNum = Err.Number
  errDesc = Err.Description
  Err.Clear

  If ext = "dwg" Then
    If SaveDrawingViaDwgTranslator(inv, drawDoc, desiredOutPath, fso) Then
      savedOutPath = desiredOutPath
      SaveDrawingDocument = True
      errNum = 0
      errDesc = ""
      Exit Function
    End If
    If Err.Number <> 0 Then
      errNum = Err.Number
      errDesc = Err.Description
    End If
    Err.Clear
    idwAlt = fso.BuildPath(fso.GetParentFolderName(desiredOutPath), fso.GetBaseName(desiredOutPath) & ".idw")
    If fso.FileExists(idwAlt) Then fso.DeleteFile idwAlt, True
    Err.Clear
    drawDoc.SaveAs idwAlt, False
    If Err.Number = 0 Then
      WScript.Echo "WARN: Could not write .dwg; saved Inventor drawing as .idw: " & idwAlt
      savedOutPath = idwAlt
      SaveDrawingDocument = True
      errNum = 0
      errDesc = ""
      Exit Function
    End If
    errNum = Err.Number
    errDesc = Err.Description
  End If

  SaveDrawingDocument = False
End Function

' iLogic automation interface (GUID is stable across many Inventor versions; fallback: scan add-ins by name).
Const kILogicAutomationAddInId = "{3bdd8d79-2179-4b11-8a5a-257b1c0263ac}"

Function GetILogicAutomation(inv)
  Dim addIn, i
  On Error Resume Next
  Set GetILogicAutomation = Nothing
  Set addIn = inv.ApplicationAddIns.ItemById(kILogicAutomationAddInId)
  If Not addIn Is Nothing And addIn.Enabled = False Then addIn.Enabled = True
  Err.Clear
  If Not addIn Is Nothing Then
    Set GetILogicAutomation = addIn.Automation
    If Not GetILogicAutomation Is Nothing Then Exit Function
  End If
  Err.Clear
  For i = 1 To inv.ApplicationAddIns.Count
    Set addIn = inv.ApplicationAddIns.Item(i)
    If InStr(1, addIn.DisplayName, "iLogic", 1) > 0 Then
      If addIn.Enabled = False Then addIn.Enabled = True
      Err.Clear
      Set GetILogicAutomation = addIn.Automation
      If Not GetILogicAutomation Is Nothing Then Exit Function
    End If
  Next
  Set GetILogicAutomation = Nothing
End Function

' RunExternalRule / RunRule often return Boolean True (-1 in VBScript) or Empty; do not require ret = 0.
Function ILogicRunOk(ByVal ret, ByVal errNum)
  On Error Resume Next
  ILogicRunOk = False
  If errNum <> 0 Then Exit Function
  If IsEmpty(ret) Then
    ILogicRunOk = True
    Exit Function
  End If
  If VarType(ret) = 11 Then
    ILogicRunOk = CBool(ret)
    Exit Function
  End If
  If IsNumeric(ret) Then
    If CLng(ret) = 0 Or CLng(ret) = -1 Then ILogicRunOk = True
  End If
End Function

' After SaveAs, use the document instance from Documents.Item so RunExternalRule gets a consistent COM reference.
Function RefreshDocByFullName(inv, doc)
  Dim fn, j, iDoc
  On Error Resume Next
  Set RefreshDocByFullName = doc
  If inv Is Nothing Or doc Is Nothing Then Exit Function
  Err.Clear
  fn = doc.FullFileName
  If Err.Number <> 0 Then Exit Function
  If Len(Trim(fn)) = 0 Then Exit Function
  For j = 1 To inv.Documents.Count
    Err.Clear
    Set iDoc = inv.Documents.Item(j)
    If Err.Number = 0 And Not iDoc Is Nothing Then
      Err.Clear
      If LCase(Trim(iDoc.FullFileName)) = LCase(Trim(fn)) Then
        Set RefreshDocByFullName = iDoc
        Exit Function
      End If
    End If
  Next
End Function

' RunExternalRule(doc, str) often raises Err 5 from VBScript late binding on Inventor 2025; 3-arg overload may work.
Function TryRunExternalRuleWithArgsMap(ia, inv, docForRule, ruleStr, ByRef lastErr, ByRef lastDesc)
  Dim nvm, ret
  On Error Resume Next
  TryRunExternalRuleWithArgsMap = False
  If ia Is Nothing Or inv Is Nothing Or docForRule Is Nothing Then Exit Function
  If Len(Trim(ruleStr)) = 0 Then Exit Function
  Set nvm = Nothing
  Err.Clear
  Set nvm = inv.TransientObjects.CreateNameValueMap
  If Err.Number <> 0 Or nvm Is Nothing Then Exit Function
  Err.Clear
  ret = ia.RunExternalRuleWithArguments(docForRule, ruleStr, nvm)
  lastErr = Err.Number
  lastDesc = Err.Description
  If ILogicRunOk(ret, Err.Number) Then TryRunExternalRuleWithArgsMap = True
End Function

' Call as Sub (no parentheses) so VBScript does not use "function result" dispatch; fixes some Err 5 cases.
Function ILogicRunExternalSub(ia, docForRule, ruleStr, ByRef lastErr, ByRef lastDesc)
  On Error Resume Next
  ILogicRunExternalSub = False
  If ia Is Nothing Or docForRule Is Nothing Or Len(Trim(ruleStr)) = 0 Then Exit Function
  Err.Clear
  ia.RunExternalRule docForRule, ruleStr
  lastErr = Err.Number
  lastDesc = Err.Description
  If lastErr = 0 Then ILogicRunExternalSub = True
End Function

Function ILogicRunExternalWithArgsSub(ia, inv, docForRule, ruleStr, ByRef lastErr, ByRef lastDesc)
  Dim nvm
  On Error Resume Next
  ILogicRunExternalWithArgsSub = False
  If ia Is Nothing Or inv Is Nothing Or docForRule Is Nothing Or Len(Trim(ruleStr)) = 0 Then Exit Function
  Err.Clear
  Set nvm = inv.TransientObjects.CreateNameValueMap
  If Err.Number <> 0 Or nvm Is Nothing Then Exit Function
  Err.Clear
  ia.RunExternalRuleWithArguments docForRule, ruleStr, nvm
  lastErr = Err.Number
  lastDesc = Err.Description
  If lastErr = 0 Then ILogicRunExternalWithArgsSub = True
End Function

Function ILogicRunRuleSub(ia, docForRule, ruleName, ByRef lastErr, ByRef lastDesc)
  On Error Resume Next
  ILogicRunRuleSub = False
  If ia Is Nothing Or docForRule Is Nothing Or Len(Trim(ruleName)) = 0 Then Exit Function
  Err.Clear
  ia.RunRule docForRule, ruleName
  lastErr = Err.Number
  lastDesc = Err.Description
  If lastErr = 0 Then ILogicRunRuleSub = True
End Function

' VBScript has no GoTo labels; use this before every Exit Function from TryRunAutoDimensionILogic.
Sub DeleteILogicSidecarIfCreated(fso, sidecarWeCreated, sidecarPath)
  On Error Resume Next
  If sidecarWeCreated And Len(sidecarPath) > 0 Then
    If fso.FileExists(sidecarPath) Then fso.DeleteFile sidecarPath, True
  End If
End Sub

' Runs iLogic after views exist. ruleCfg: embedded rule name, OR file base name for ilogic_rules\<base>.txt
Function TryRunAutoDimensionILogic(inv, drawDoc, fso, ruleCfg, partPathForLog)
  Dim ia, ret, scriptDir, rulesDir, p1, p2, lastErr, lastDesc
  Dim partDir, sidecarPath, ruleFn, sidecarWeCreated
  Dim docForRule
  On Error Resume Next
  TryRunAutoDimensionILogic = False
  lastErr = 0
  lastDesc = ""
  sidecarWeCreated = False
  sidecarPath = ""
  ruleFn = ""
  ruleCfg = Trim(ruleCfg)
  If Len(ruleCfg) = 0 Then
    TryRunAutoDimensionILogic = True
    DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
    Exit Function
  End If

  If gAutoDimILogicUnavailable And Not AUTO_DIMENSION_VERBOSE Then
    TryRunAutoDimensionILogic = False
    DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
    Exit Function
  End If

  Set ia = GetILogicAutomation(inv)
  If ia Is Nothing Then
    If Not gAutoDimNoILogicWarned Then
      gAutoDimNoILogicWarned = True
      WScript.Echo "AUTO-DIM: iLogic add-in not found or has no Automation. Enable iLogic and retry."
    End If
    DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
    Exit Function
  End If

  drawDoc.Activate
  Err.Clear
  Set docForRule = RefreshDocByFullName(inv, drawDoc)

  scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
  rulesDir = fso.BuildPath(scriptDir, "ilogic_rules")
  p1 = fso.BuildPath(rulesDir, ruleCfg)
  p2 = fso.BuildPath(rulesDir, ruleCfg & ".txt")

  If fso.FileExists(p2) Then
    partDir = fso.GetParentFolderName(partPathForLog)
    ruleFn = fso.GetFileName(p2)
    If fso.FolderExists(partDir) Then
      sidecarPath = fso.BuildPath(partDir, ruleFn)
      If fso.FileExists(sidecarPath) Then
        ' Already in workspace; do not delete later.
      Else
        Err.Clear
        fso.CopyFile p2, sidecarPath, True
        If Err.Number = 0 Then
          sidecarWeCreated = True
        Else
          WScript.Echo "AUTO-DIM: could not copy rule beside part: " & Err.Number & " " & Err.Description
          Err.Clear
          sidecarPath = ""
        End If
      End If
    End If
  End If

  If Len(ruleFn) > 0 And Len(sidecarPath) > 0 And fso.FileExists(sidecarPath) Then
    If ILogicRunExternalSub(ia, docForRule, ruleFn, lastErr, lastDesc) Then
      WScript.Echo "AUTO-DIM: RunExternalRule Sub-call """ & ruleFn & """"
      TryRunAutoDimensionILogic = True
      DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
      Exit Function
    End If
  End If
  If ILogicRunExternalSub(ia, docForRule, ruleCfg, lastErr, lastDesc) Then
    WScript.Echo "AUTO-DIM: RunExternalRule Sub-call """ & ruleCfg & """"
    TryRunAutoDimensionILogic = True
    DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
    Exit Function
  End If
  If ILogicRunExternalSub(ia, docForRule, ruleCfg & ".txt", lastErr, lastDesc) Then
    WScript.Echo "AUTO-DIM: RunExternalRule Sub-call """ & ruleCfg & ".txt"""
    TryRunAutoDimensionILogic = True
    DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
    Exit Function
  End If
  If Len(sidecarPath) > 0 And fso.FileExists(sidecarPath) Then
    If ILogicRunExternalSub(ia, docForRule, sidecarPath, lastErr, lastDesc) Then
      WScript.Echo "AUTO-DIM: RunExternalRule Sub-call sidecar full path"
      TryRunAutoDimensionILogic = True
      DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
      Exit Function
    End If
  End If
  If fso.FileExists(p2) Then
    If ILogicRunExternalSub(ia, docForRule, p2, lastErr, lastDesc) Then
      WScript.Echo "AUTO-DIM: RunExternalRule Sub-call repo p2"
      TryRunAutoDimensionILogic = True
      DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
      Exit Function
    End If
  End If

  If ILogicRunExternalWithArgsSub(ia, inv, docForRule, ruleCfg, lastErr, lastDesc) Then
    WScript.Echo "AUTO-DIM: RunExternalRuleWithArguments Sub-call """ & ruleCfg & """"
    TryRunAutoDimensionILogic = True
    DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
    Exit Function
  End If
  If ILogicRunExternalWithArgsSub(ia, inv, docForRule, ruleCfg & ".txt", lastErr, lastDesc) Then
    WScript.Echo "AUTO-DIM: RunExternalRuleWithArguments Sub-call """ & ruleCfg & ".txt"""
    TryRunAutoDimensionILogic = True
    DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
    Exit Function
  End If
  If Len(ruleFn) > 0 Then
    If ILogicRunExternalWithArgsSub(ia, inv, docForRule, ruleFn, lastErr, lastDesc) Then
      WScript.Echo "AUTO-DIM: RunExternalRuleWithArguments Sub-call """ & ruleFn & """"
      TryRunAutoDimensionILogic = True
      DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
      Exit Function
    End If
  End If
  If Len(sidecarPath) > 0 And fso.FileExists(sidecarPath) Then
    If ILogicRunExternalWithArgsSub(ia, inv, docForRule, sidecarPath, lastErr, lastDesc) Then
      WScript.Echo "AUTO-DIM: RunExternalRuleWithArguments Sub-call sidecar path"
      TryRunAutoDimensionILogic = True
      DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
      Exit Function
    End If
  End If
  If fso.FileExists(p2) Then
    If ILogicRunExternalWithArgsSub(ia, inv, docForRule, p2, lastErr, lastDesc) Then
      WScript.Echo "AUTO-DIM: RunExternalRuleWithArguments Sub-call p2"
      TryRunAutoDimensionILogic = True
      DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
      Exit Function
    End If
  End If

  If Len(sidecarPath) > 0 And fso.FileExists(sidecarPath) Then
    Err.Clear
    ret = ia.RunExternalRule(docForRule, ruleFn)
    lastErr = Err.Number
    lastDesc = Err.Description
    If ILogicRunOk(ret, Err.Number) Then
      WScript.Echo "AUTO-DIM: RunExternalRule """ & ruleFn & """ (workspace/sidecar, ret=" & ret & ")"
      TryRunAutoDimensionILogic = True
      DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
      Exit Function
    End If
    Err.Clear
    ret = ia.RunExternalRule(ruleFn, docForRule)
    If ILogicRunOk(ret, Err.Number) Then
      WScript.Echo "AUTO-DIM: RunExternalRule (arg order swap) """ & ruleFn & """ ret=" & ret
      TryRunAutoDimensionILogic = True
      DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
      Exit Function
    End If
    lastErr = Err.Number
    lastDesc = Err.Description
    Err.Clear
    ret = ia.RunExternalRule(docForRule, ruleCfg)
    lastErr = Err.Number
    lastDesc = Err.Description
    If ILogicRunOk(ret, Err.Number) Then
      WScript.Echo "AUTO-DIM: RunExternalRule """ & ruleCfg & """ (workspace/sidecar, ret=" & ret & ")"
      TryRunAutoDimensionILogic = True
      DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
      Exit Function
    End If
    Err.Clear
    ret = ia.RunExternalRule(docForRule, ruleCfg & ".txt")
    lastErr = Err.Number
    lastDesc = Err.Description
    If ILogicRunOk(ret, Err.Number) Then
      WScript.Echo "AUTO-DIM: RunExternalRule """ & ruleCfg & ".txt"" (workspace/sidecar, ret=" & ret & ")"
      TryRunAutoDimensionILogic = True
      DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
      Exit Function
    End If
    Err.Clear
    ret = ia.RunExternalRule(docForRule, sidecarPath)
    lastErr = Err.Number
    lastDesc = Err.Description
    If ILogicRunOk(ret, Err.Number) Then
      WScript.Echo "AUTO-DIM: RunExternalRule full path sidecar (ret=" & ret & ")"
      TryRunAutoDimensionILogic = True
      DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
      Exit Function
    End If
    If fso.FileExists(p2) Then
      Err.Clear
      ret = ia.RunExternalRule(docForRule, p2)
      lastErr = Err.Number
      lastDesc = Err.Description
      If ILogicRunOk(ret, Err.Number) Then
        WScript.Echo "AUTO-DIM: RunExternalRule repo rule path p2 (ret=" & ret & ")"
        TryRunAutoDimensionILogic = True
        DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
        Exit Function
      End If
    End If
  End If

  Err.Clear
  If fso.FileExists(p2) Or fso.FileExists(p1) Then
    Err.Clear
    ret = ia.RunExternalRule(docForRule, ruleCfg)
    lastErr = Err.Number
    lastDesc = Err.Description
    If ILogicRunOk(ret, Err.Number) Then
      WScript.Echo "AUTO-DIM: RunExternalRule """ & ruleCfg & """ (ret=" & ret & ")"
      TryRunAutoDimensionILogic = True
      DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
      Exit Function
    End If
    Err.Clear
    ret = ia.RunExternalRule(docForRule, ruleCfg & ".txt")
    lastErr = Err.Number
    lastDesc = Err.Description
    If ILogicRunOk(ret, Err.Number) Then
      WScript.Echo "AUTO-DIM: RunExternalRule """ & ruleCfg & ".txt"" (ret=" & ret & ")"
      TryRunAutoDimensionILogic = True
      DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
      Exit Function
    End If
  End If

  If TryRunExternalRuleWithArgsMap(ia, inv, docForRule, ruleCfg, lastErr, lastDesc) Then
    WScript.Echo "AUTO-DIM: RunExternalRuleWithArguments """ & ruleCfg & """ (ret ok)"
    TryRunAutoDimensionILogic = True
    DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
    Exit Function
  End If
  If TryRunExternalRuleWithArgsMap(ia, inv, docForRule, ruleCfg & ".txt", lastErr, lastDesc) Then
    WScript.Echo "AUTO-DIM: RunExternalRuleWithArguments """ & ruleCfg & ".txt"" (ret ok)"
    TryRunAutoDimensionILogic = True
    DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
    Exit Function
  End If
  If Len(ruleFn) > 0 Then
    If TryRunExternalRuleWithArgsMap(ia, inv, docForRule, ruleFn, lastErr, lastDesc) Then
      WScript.Echo "AUTO-DIM: RunExternalRuleWithArguments """ & ruleFn & """ (ret ok)"
      TryRunAutoDimensionILogic = True
      DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
      Exit Function
    End If
  End If
  If Len(sidecarPath) > 0 And fso.FileExists(sidecarPath) Then
    If TryRunExternalRuleWithArgsMap(ia, inv, docForRule, sidecarPath, lastErr, lastDesc) Then
      WScript.Echo "AUTO-DIM: RunExternalRuleWithArguments sidecar full path (ret ok)"
      TryRunAutoDimensionILogic = True
      DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
      Exit Function
    End If
  End If
  If fso.FileExists(p2) Then
    If TryRunExternalRuleWithArgsMap(ia, inv, docForRule, p2, lastErr, lastDesc) Then
      WScript.Echo "AUTO-DIM: RunExternalRuleWithArguments repo p2 (ret ok)"
      TryRunAutoDimensionILogic = True
      DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
      Exit Function
    End If
  End If

  If ILogicRunRuleSub(ia, docForRule, ruleCfg, lastErr, lastDesc) Then
    WScript.Echo "AUTO-DIM: RunRule Sub-call """ & ruleCfg & """ (embedded)"
    TryRunAutoDimensionILogic = True
    DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
    Exit Function
  End If

  Err.Clear
  ret = ia.RunRule(docForRule, ruleCfg)
  lastErr = Err.Number
  lastDesc = Err.Description
  If ILogicRunOk(ret, Err.Number) Then
    WScript.Echo "AUTO-DIM: RunRule """ & ruleCfg & """ (embedded) ret=" & ret
    TryRunAutoDimensionILogic = True
    DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
    Exit Function
  End If

  If AUTO_DIMENSION_VERBOSE Then
    WScript.Echo "AUTO-DIM: iLogic failed for " & partPathForLog & " rule=""" & ruleCfg & """ lastErr=" & lastErr & " " & lastDesc
  Else
    If Not gAutoDimOnceQuietILogic Then
      WScript.Echo "AUTO-DIM: iLogic RunExternalRule/RunRule from cscript fails (e.g. Err " & lastErr & "). Later parts skip iLogic. Use verbose on the command line for per-file lines; set AUTO_DIMENSION_ILOGIC_RULE=\"\" or nodim for a clean log."
      gAutoDimOnceQuietILogic = True
    End If
  End If
  If Not AUTO_DIMENSION_VERBOSE Then gAutoDimILogicUnavailable = True
  DeleteILogicSidecarIfCreated fso, sidecarWeCreated, sidecarPath
End Function

' Native Inventor API: GeneralDimensions.AddLinear(textPoint, intent1, intent2) — point first, not iLogic's string key overload.
' Matches ilogic_rules\CC_ZBar_AutoDimension.txt (D17/D18/D19 edge names; DrawingView.GetIntent is iLogic-only from cscript).
Function TryAddZBarLinearPair(genDims, pt, iA, iB, tag)
  On Error Resume Next
  TryAddZBarLinearPair = False
  If genDims Is Nothing Or pt Is Nothing Or iA Is Nothing Or iB Is Nothing Then Exit Function
  Err.Clear
  genDims.AddLinear pt, iA, iB
  If Err.Number = 0 Then TryAddZBarLinearPair = True : Exit Function
  Err.Clear
  genDims.AddLinear pt, iB, iA
  TryAddZBarLinearPair = (Err.Number = 0)
End Function

Function TryAddZBarAngularPair(genDims, pt, iA, iB, tag)
  On Error Resume Next
  TryAddZBarAngularPair = False
  If genDims Is Nothing Or pt Is Nothing Or iA Is Nothing Or iB Is Nothing Then Exit Function
  Err.Clear
  genDims.AddAngular pt, iA, iB
  If Err.Number = 0 Then TryAddZBarAngularPair = True : Exit Function
  Err.Clear
  genDims.AddAngular pt, iB, iA
  TryAddZBarAngularPair = (Err.Number = 0)
End Function

Function TryAddZBarAutoDimensionsCom(inv, drawDoc, partPathForLog)
  Dim sh, v, genDims
  Dim iD17O, iD17I, iD18O, iD18I, iD19O, iD19I, iD20O, iD20I
  Dim ptL1, ptL2, ptL3, ptL4, ptA1, ptA2, app, tg
  On Error Resume Next
  TryAddZBarAutoDimensionsCom = False
  If gAutoDimComGetIntentUnavailable And Not AUTO_DIMENSION_VERBOSE Then Exit Function
  If AUTO_DIMENSION_VERBOSE Then
    WScript.Echo "AUTO-DIM COM: trying Z-bar dimensions (native API) for " & partPathForLog
  End If
  drawDoc.Activate
  Err.Clear
  drawDoc.Update2 True
  Err.Clear
  Set sh = drawDoc.Sheets.Item(1)
  If sh Is Nothing Or Err.Number <> 0 Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: no sheet 1 - " & Err.Number & " " & Err.Description
    Exit Function
  End If
  If sh.DrawingViews.Count < 1 Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: no drawing views on sheet 1"
    Exit Function
  End If
  Set v = sh.DrawingViews.Item(1)
  If v Is Nothing Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: could not get DrawingViews.Item(1)"
    Exit Function
  End If
  Err.Clear
  Set genDims = sh.DrawingDimensions.GeneralDimensions
  If genDims Is Nothing Or Err.Number <> 0 Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: GeneralDimensions - " & Err.Number & " " & Err.Description
    Exit Function
  End If

  Err.Clear
  Set iD17O = v.GetIntent("D17O")
  If Err.Number <> 0 Or iD17O Is Nothing Then
    If Err.Number = 424 Or Err.Number = 438 Then
      If Not AUTO_DIMENSION_VERBOSE Then gAutoDimComGetIntentUnavailable = True
      If AUTO_DIMENSION_VERBOSE Then
        WScript.Echo "AUTO-DIM COM: GetIntent(D17O) iLogic-only Err " & Err.Number & " - " & partPathForLog
      ElseIf Not gAutoDimOnceQuietCom Then
        WScript.Echo "AUTO-DIM COM: DrawingView.GetIntent is iLogic-only (Err " & Err.Number & " from VBScript). Z-bar COM fallback cannot run. Dimension inside Inventor, or set AUTO_DIMENSION_ILOGIC_RULE=\"\" or use nodim on the command line."
        gAutoDimOnceQuietCom = True
      End If
    Else
      WScript.Echo "AUTO-DIM COM: GetIntent(D17O) failed " & Err.Number & " - name edges on .ipt (" & partPathForLog & ")"
    End If
    Exit Function
  End If
  Err.Clear
  Set iD17I = v.GetIntent("D17I")
  If Err.Number <> 0 Or iD17I Is Nothing Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: GetIntent(D17I) failed " & Err.Number
    Exit Function
  End If
  Err.Clear
  Set iD18O = v.GetIntent("D18O")
  If Err.Number <> 0 Or iD18O Is Nothing Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: GetIntent(D18O) failed " & Err.Number
    Exit Function
  End If
  Err.Clear
  Set iD18I = v.GetIntent("D18I")
  If Err.Number <> 0 Or iD18I Is Nothing Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: GetIntent(D18I) failed " & Err.Number
    Exit Function
  End If
  Err.Clear
  Set iD19O = v.GetIntent("D19O")
  If Err.Number <> 0 Or iD19O Is Nothing Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: GetIntent(D19O) failed " & Err.Number
    Exit Function
  End If
  Err.Clear
  Set iD19I = v.GetIntent("D19I")
  If Err.Number <> 0 Or iD19I Is Nothing Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: GetIntent(D19I) failed " & Err.Number
    Exit Function
  End If
  Err.Clear
  Set iD20O = v.GetIntent("D20O")
  If Err.Number <> 0 Or iD20O Is Nothing Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: GetIntent(D20O) failed " & Err.Number
    Exit Function
  End If
  Err.Clear
  Set iD20I = v.GetIntent("D20I")
  If Err.Number <> 0 Or iD20I Is Nothing Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: GetIntent(D20I) failed " & Err.Number
    Exit Function
  End If

  Set app = Nothing
  If Not drawDoc Is Nothing Then Set app = drawDoc.Application
  If app Is Nothing Then Set app = inv
  Set tg = Nothing
  If Not app Is Nothing Then Set tg = app.TransientGeometry

  Err.Clear
  Set ptL1 = v.SheetPoint(0.55, -0.14)
  If Err.Number <> 0 Or ptL1 Is Nothing Then
    Err.Clear
    If Not tg Is Nothing Then Set ptL1 = tg.CreatePoint2d(0.55, -0.14)
  End If
  If ptL1 Is Nothing Then Exit Function
  If Not TryAddZBarLinearPair(genDims, ptL1, iD17O, iD19O, "LIN1") Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: AddLinear LIN1 failed"
    Exit Function
  End If

  Err.Clear
  Set ptL2 = v.SheetPoint(-0.14, 0.45)
  If Err.Number <> 0 Or ptL2 Is Nothing Then
    Err.Clear
    If Not tg Is Nothing Then Set ptL2 = tg.CreatePoint2d(-0.14, 0.45)
  End If
  If ptL2 Is Nothing Then Exit Function
  If Not TryAddZBarLinearPair(genDims, ptL2, iD17I, iD19I, "LIN2") Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: AddLinear LIN2 failed"
    Exit Function
  End If

  Err.Clear
  Set ptL3 = v.SheetPoint(0.52, -0.24)
  If Err.Number <> 0 Or ptL3 Is Nothing Then
    Err.Clear
    If Not tg Is Nothing Then Set ptL3 = tg.CreatePoint2d(0.52, -0.24)
  End If
  If ptL3 Is Nothing Then Exit Function
  If Not TryAddZBarLinearPair(genDims, ptL3, iD20I, iD18I, "LIN3") Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: AddLinear LIN3 failed"
    Exit Function
  End If

  Err.Clear
  Set ptL4 = v.SheetPoint(0.58, 0.42)
  If Err.Number <> 0 Or ptL4 Is Nothing Then
    Err.Clear
    If Not tg Is Nothing Then Set ptL4 = tg.CreatePoint2d(0.58, 0.42)
  End If
  If ptL4 Is Nothing Then Exit Function
  If Not TryAddZBarLinearPair(genDims, ptL4, iD18O, iD20O, "LIN4") Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: AddLinear LIN4 failed"
    Exit Function
  End If

  Err.Clear
  Set ptA1 = v.SheetPoint(0.08, 0.12)
  If Err.Number <> 0 Or ptA1 Is Nothing Then
    Err.Clear
    If Not tg Is Nothing Then Set ptA1 = tg.CreatePoint2d(0.08, 0.12)
  End If
  If ptA1 Is Nothing Then Exit Function
  If Not TryAddZBarAngularPair(genDims, ptA1, iD17O, iD18O, "ANG1") Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: AddAngular ANG1 failed"
    Exit Function
  End If

  Err.Clear
  Set ptA2 = v.SheetPoint(-0.06, 0.20)
  If Err.Number <> 0 Or ptA2 Is Nothing Then
    Err.Clear
    If Not tg Is Nothing Then Set ptA2 = tg.CreatePoint2d(-0.06, 0.20)
  End If
  If ptA2 Is Nothing Then Exit Function
  If Not TryAddZBarAngularPair(genDims, ptA2, iD18I, iD19I, "ANG2") Then
    If AUTO_DIMENSION_VERBOSE Then WScript.Echo "AUTO-DIM COM: AddAngular ANG2 failed"
    Exit Function
  End If

  Err.Clear
  drawDoc.Update2 True
  TryAddZBarAutoDimensionsCom = True
  WScript.Echo "AUTO-DIM COM: Z-bar dimensions added for " & partPathForLog & " (second save writes .idw)."
End Function

' --- Z-bar title/gauge for batch (match batch_generate_z_parts.vbs + CC_Drawing_OnOpen_Auto) ---
Const kZBarIpropGauge = "Gauge"
Const kZBarParamGauge = "Gauge"

Function ZBarTitleFromThouVbs(thou)
  Dim v, s, dotPos
  v = thou / 1000.0
  s = Replace(CStr(Round(v, 6)), ",", ".")
  dotPos = InStr(s, ".")
  If dotPos > 0 Then
    Do While Len(s) > dotPos And Right(s, 1) = "0"
      s = Left(s, Len(s) - 1)
    Loop
    If Right(s, 1) = "." Then s = Left(s, Len(s) - 1)
  End If
  ZBarTitleFromThouVbs = "Z BAR " & s
End Function

Function ZBarParseBaseNameVbs(baseNm, ByRef gNum, ByRef thou)
  ZBarParseBaseNameVbs = False
  If Len(baseNm) < 8 Then Exit Function
  If UCase(Left(baseNm, 1)) <> "Z" Then Exit Function
  On Error Resume Next
  gNum = CInt(Mid(baseNm, 2, 2))
  thou = CInt(Mid(baseNm, 4, 5))
  If Err.Number <> 0 Then
    Err.Clear
    Exit Function
  End If
  ZBarParseBaseNameVbs = True
End Function

Function TryGetGaugeLabelFromPartVbs(partDoc, defaultGaugeStr)
  Dim up, ex
  On Error Resume Next
  TryGetGaugeLabelFromPartVbs = defaultGaugeStr
  Set up = partDoc.ComponentDefinition.Parameters.UserParameters.Item(kZBarParamGauge)
  If Err.Number <> 0 Then Exit Function
  Err.Clear
  ex = Trim(CStr(up.Expression))
  If Len(ex) >= 2 And Left(ex, 1) = """" And Right(ex, 1) = """" Then
    TryGetGaugeLabelFromPartVbs = Mid(ex, 2, Len(ex) - 2)
  ElseIf Len(ex) > 0 Then
    TryGetGaugeLabelFromPartVbs = ex
  End If
End Function

Sub TrySetSummaryTitleVbs(doc, titleText)
  Dim ps
  On Error Resume Next
  Set ps = doc.PropertySets.Item("Inventor Document Summary")
  If Err.Number = 0 Then
    ps.Item("Title").Value = titleText
    Err.Clear
    Exit Sub
  End If
  Err.Clear
  Set ps = doc.PropertySets.Item("Inventor Summary Information")
  If Err.Number = 0 Then ps.Item("Title").Value = titleText
  Err.Clear
End Sub

Sub TrySetUserDefinedGaugeVbs(doc, propValue)
  Dim ps, it
  On Error Resume Next
  Set ps = doc.PropertySets.Item("Inventor User Defined Properties")
  If Err.Number <> 0 Then
    Err.Clear
    Exit Sub
  End If
  Set it = ps.Item(kZBarIpropGauge)
  If Err.Number = 0 Then
    it.Value = propValue
    Err.Clear
    Exit Sub
  End If
  Err.Clear
  ps.Add propValue, kZBarIpropGauge
  If Err.Number <> 0 Then
    Err.Clear
    ps.Add kZBarIpropGauge, propValue
  End If
  Err.Clear
End Sub

Sub ApplyZBarTitleGaugeVbs(doc, titleText, gaugeLabel)
  TrySetSummaryTitleVbs doc, titleText
  TrySetUserDefinedGaugeVbs doc, gaugeLabel
End Sub

Sub ProcessPart(inv, partPath, drawTpl, outPath, fso)
  Dim partDoc, drawDoc
  Dim placed, lastErrNum, lastErrDesc
  Dim hasFp, fn, relinked, useDwgRetry
  Dim docErrNum, docErrDesc
  Dim savedPath, saveErrNum, saveErrDesc
  Dim dimOk, ruleWanted
  Dim bnZ, gNumZ, thouZ, titleZ, gaugeZ

  On Error Resume Next
  Set partDoc = inv.Documents.Open(partPath, False)
  If Err.Number <> 0 Then
    WScript.Echo "SKIP open part: " & partPath & " - " & Err.Number & " " & Err.Description
    Err.Clear
    Exit Sub
  End If

  partDoc.Update2 True
  Err.Clear
  hasFp = PartHasFlatPattern(partDoc)
  If hasFp Then
    partDoc.ComponentDefinition.FlatPattern.Update
    Err.Clear
  End If

  bnZ = fso.GetBaseName(partPath)
  If ZBarParseBaseNameVbs(bnZ, gNumZ, thouZ) Then
    titleZ = ZBarTitleFromThouVbs(thouZ)
    gaugeZ = TryGetGaugeLabelFromPartVbs(partDoc, CStr(gNumZ))
    ApplyZBarTitleGaugeVbs partDoc, titleZ, gaugeZ
    Err.Clear
    partDoc.Update2 True
    Err.Clear
    partDoc.Save
    Err.Clear
  End If

  WScript.Sleep 200

  inv.SilentOperation = True
  Err.Clear
  inv.UserInterfaceManager.UserInteractionDisabled = True
  Err.Clear

  fn = partDoc.FullFileName
  If Err.Number <> 0 Or Len(fn) = 0 Then
    Err.Clear
    fn = partDoc.FullDocumentName
  End If
  Err.Clear

  useDwgRetry = (Len(gDwgTemplatePath) > 0 And LCase(Replace(gDwgTemplatePath, "/", "\")) <> LCase(Replace(drawTpl, "/", "\")))

  Set drawDoc = GetOrCreateDrawingFromTemplate(inv, drawTpl, fso, "", docErrNum, docErrDesc)
  If drawDoc Is Nothing Then
    WScript.Echo "SKIP drawing create: " & partPath & " - " & docErrNum & " " & docErrDesc
    partDoc.Close False
    Err.Clear
    Exit Sub
  End If

  WScript.Sleep 200
  drawDoc.Activate
  Err.Clear

  relinked = False
  BatchLinkAndClearViews inv, drawDoc, partDoc, fn, relinked

  placed = False
  lastErrNum = 0
  lastErrDesc = ""
  If relinked And DrawingTotalViewCount(drawDoc) > 0 Then
    placed = True
  Else
    AttemptPlaceViewsOnDrawing inv, drawDoc, partDoc, hasFp, placed, lastErrNum, lastErrDesc
  End If

  If Not placed And useDwgRetry And FileExists(gDwgTemplatePath) Then
    CloseDrawingDocCleanupTemp drawDoc, fso
    Err.Clear
    Set drawDoc = Nothing
    Set drawDoc = GetOrCreateDrawingFromTemplate(inv, gDwgTemplatePath, fso, "", docErrNum, docErrDesc)
    If Not drawDoc Is Nothing Then
      WScript.Sleep 200
      drawDoc.Activate
      Err.Clear
      relinked = False
      BatchLinkAndClearViews inv, drawDoc, partDoc, fn, relinked
      If relinked And DrawingTotalViewCount(drawDoc) > 0 Then
        placed = True
      Else
        AttemptPlaceViewsOnDrawing inv, drawDoc, partDoc, hasFp, placed, lastErrNum, lastErrDesc
      End If
    Else
      WScript.Echo "SKIP drawing create (.dwg retry): " & partPath & " - " & docErrNum & " " & docErrDesc
      Set drawDoc = Nothing
      Err.Clear
    End If
  End If

  If Not placed Then
    If Not gLoggedBaseViewError Then
      gLoggedBaseViewError = True
      WScript.Echo "HINT: Inventor 2025 + VBScript often cannot call ReferencedDocumentDescriptors.Add (438). Put one Base View on the drawing template (any placeholder .ipt); the script uses FileDescriptor.ReplaceReference. Also fix sheet metal red X on the .ipt if views fail."
      WScript.Echo "Last view error: " & lastErrNum & " " & lastErrDesc
    End If
    WScript.Echo "SKIP base view: " & partPath
    partDoc.Close False
    CloseDrawingDocCleanupTemp drawDoc, fso
    Err.Clear
    Exit Sub
  End If

  drawDoc.Activate
  Err.Clear
  drawDoc.Update2 True
  Err.Clear
  If ZBarParseBaseNameVbs(bnZ, gNumZ, thouZ) Then
    titleZ = ZBarTitleFromThouVbs(thouZ)
    gaugeZ = TryGetGaugeLabelFromPartVbs(partDoc, CStr(gNumZ))
    ApplyZBarTitleGaugeVbs drawDoc, titleZ, gaugeZ
    Err.Clear
    ApplyZBarTitleGaugeVbs partDoc, titleZ, gaugeZ
    Err.Clear
    drawDoc.Update2 True
    Err.Clear
  End If
  ' Save before iLogic: RunExternalRule often fails (Err 5) on an unsaved drawing with no resolved document path.
  If Not SaveDrawingDocument(inv, drawDoc, outPath, fso, savedPath, saveErrNum, saveErrDesc) Then
    WScript.Echo "SKIP save drawing (before auto-dim): " & outPath & " - " & saveErrNum & " " & saveErrDesc
    partDoc.Close False
    CloseDrawingDocCleanupTemp drawDoc, fso
    Err.Clear
    Exit Sub
  End If

  drawDoc.Activate
  Err.Clear
  drawDoc.Update2 True
  Err.Clear
  inv.SilentOperation = False
  inv.UserInterfaceManager.UserInteractionDisabled = False
  Err.Clear
  ruleWanted = (Len(Trim(AUTO_DIMENSION_ILOGIC_RULE)) > 0) And Not gBatchNoAutoDim
  dimOk = False
  If ruleWanted Then
    dimOk = TryRunAutoDimensionILogic(inv, drawDoc, fso, AUTO_DIMENSION_ILOGIC_RULE, partPath)
  End If
  If ruleWanted And Not dimOk Then
    If StrComp(Trim(AUTO_DIMENSION_ILOGIC_RULE), "CC_ZBar_AutoDimension", vbTextCompare) = 0 Then
      Err.Clear
      dimOk = TryAddZBarAutoDimensionsCom(inv, drawDoc, partPath)
    End If
  End If
  Err.Clear
  inv.SilentOperation = True
  inv.UserInterfaceManager.UserInteractionDisabled = True
  Err.Clear

  ' Failed RunExternalRule (Err 5) can leave the drawing unable to Save/SaveAs again. First save is already on disk;
  ' only save a second time when a rule was configured and reported success (dimensions changed).
  If ruleWanted And dimOk Then
    drawDoc.Activate
    Err.Clear
    drawDoc.Update2 True
    Err.Clear
    If Not SaveDrawingDocument(inv, drawDoc, outPath, fso, savedPath, saveErrNum, saveErrDesc) Then
      Err.Clear
      drawDoc.Save
      If Err.Number <> 0 Then
        WScript.Echo "SKIP save drawing (after auto-dim): " & outPath & " - SaveDrawingDocument: " & saveErrNum & " " & saveErrDesc & "  Save: " & Err.Number & " " & Err.Description
        partDoc.Close False
        CloseDrawingDocCleanupTemp drawDoc, fso
        Err.Clear
        Exit Sub
      End If
      savedPath = outPath
    End If
  ElseIf ruleWanted And Not dimOk Then
    If AUTO_DIMENSION_VERBOSE Then
      WScript.Echo "AUTO-DIM: drawing left as first save (no script dims): " & outPath
    ElseIf Not gAutoDimOnceQuietFirstSave Then
      WScript.Echo "AUTO-DIM: drawings saved without script dimensions for parts where auto-dim did not apply (one-time note)."
      gAutoDimOnceQuietFirstSave = True
    End If
  End If

  partDoc.Close False
  CloseDrawingDocCleanupTemp drawDoc, fso
  gBatchDrawingOk = gBatchDrawingOk + 1
  WScript.Echo "OK   " & savedPath
End Sub

Dim fso, folder, f, baseName, outPath, drawExt
Dim tplCreate, companion
Dim partsScanFolder

If Not FileExists(DRAWING_TEMPLATE) Then
  WScript.Echo "Template not found: " & DRAWING_TEMPLATE
  WScript.Echo "If your file uses another extension or name, update DRAWING_TEMPLATE in this script."
  WScript.Quit 1
End If

Set fso = CreateObject("Scripting.FileSystemObject")
partsScanFolder = PARTS_FOLDER
If Len(Trim(VARIANTS_FOLDER)) > 0 Then partsScanFolder = Trim(VARIANTS_FOLDER)
If Not fso.FolderExists(partsScanFolder) Then
  WScript.Echo "Folder not found (parts scan): " & partsScanFolder
  WScript.Quit 1
End If
If Len(Trim(VARIANTS_FOLDER)) > 0 And Not fso.FolderExists(PARTS_FOLDER) Then
  WScript.Echo "WARN: PARTS_FOLDER missing (set to folder with .ipj if needed): " & PARTS_FOLDER
End If

drawExt = LCase(fso.GetExtensionName(DRAWING_TEMPLATE))
If drawExt <> "dwg" And drawExt <> "idw" Then drawExt = "idw"

tplCreate = DRAWING_TEMPLATE
If drawExt = "dwg" Then
  gDwgTemplatePath = DRAWING_TEMPLATE
  companion = fso.BuildPath(fso.GetParentFolderName(DRAWING_TEMPLATE), fso.GetBaseName(DRAWING_TEMPLATE) & ".idw")
  If fso.FileExists(companion) Then
    tplCreate = companion
    WScript.Echo "Using companion .idw for new drawings: " & companion
  Else
    WScript.Echo "NOTE: If views still fail, create: " & companion
    WScript.Echo "      (In Inventor: open CC2026.dwg, Save Copy As, type CC2026.idw, same folder.)"
  End If
End If

Dim batchOutExt, tmpOutExt, iptCount
batchOutExt = drawExt
tmpOutExt = LCase(Trim(OUTPUT_DRAWING_EXT))
If Len(tmpOutExt) > 0 Then
  If tmpOutExt = "dwg" Or tmpOutExt = "idw" Then batchOutExt = tmpOutExt
End If
If batchOutExt <> drawExt Then
  WScript.Echo "OUTPUT_DRAWING_EXT: files will be *." & batchOutExt & " (template is ." & drawExt & ")"
End If

Dim inv
On Error Resume Next
Set inv = CreateObject("Inventor.Application")
If Err.Number <> 0 Then Fail("CreateObject(Inventor.Application)")
' Hidden Inventor frequently returns E_FAIL (0x80004005) from AddBaseView - graphics must resolve.
inv.Visible = True
RestoreInventorUi inv
inv.SilentOperation = True
Err.Clear
inv.UserInterfaceManager.UserInteractionDisabled = True
Err.Clear

Dim parseArgI, parseArgS
For parseArgI = 0 To WScript.Arguments.Count - 1
  parseArgS = LCase(Trim(WScript.Arguments(parseArgI)))
  If parseArgS = "diag" Then gDiagMode = True
  If parseArgS = "overwrite" Or parseArgS = "/overwrite" Or parseArgS = "-overwrite" Then
    OVERWRITE_EXISTING_DRAWINGS = True
    gOverwriteFromCmdLine = True
  End If
  If parseArgS = "nodim" Or parseArgS = "/nodim" Or parseArgS = "-nodim" Then gBatchNoAutoDim = True
  If parseArgS = "verbose" Or parseArgS = "/verbose" Or parseArgS = "-verbose" Then AUTO_DIMENSION_VERBOSE = True
Next

If Len(Trim(INVENTOR_PROJECT)) = 0 Then
  INVENTOR_PROJECT = FirstIpjInFolder(fso, partsScanFolder)
  If Len(INVENTOR_PROJECT) = 0 And Len(Trim(VARIANTS_FOLDER)) > 0 Then
    INVENTOR_PROJECT = FirstIpjInFolder(fso, PARTS_FOLDER)
  End If
  If Len(INVENTOR_PROJECT) > 0 Then
    WScript.Echo "Using .ipj: " & INVENTOR_PROJECT
  End If
End If

MaybeActivateProject inv, fso
TrySetOldVersionsKeep inv, 0

If gOverwriteFromCmdLine Then
  WScript.Echo "Batch: overwrite enabled (command line) - existing output drawings next to .ipt will be replaced."
End If
If gBatchNoAutoDim Then
  WScript.Echo "Batch: nodim - iLogic/COM auto-dimension skipped for this run."
End If
If AUTO_DIMENSION_VERBOSE Then
  WScript.Echo "Batch: verbose - AUTO-DIM line per .ipt enabled."
End If

If gDiagMode Then
  WScript.Echo "DIAG: Test-only (no SaveAs). To create drawing files run without diag: cscript //nologo batch_part_drawings.vbs"
  Dim diagPath, tplFolder
  If WScript.Arguments.Count >= 2 Then
    diagPath = Trim(WScript.Arguments(1))
  Else
    diagPath = FirstIptInFolder(fso, partsScanFolder)
  End If
  If Len(diagPath) = 0 Or Not fso.FileExists(diagPath) Then
    WScript.Echo "DIAG: No .ipt found. Usage: cscript //nologo batch_part_drawings.vbs diag [""full\path\part.ipt""]"
    RestoreInventorUi inv
    WScript.Quit 2
  End If
  tplFolder = fso.GetParentFolderName(tplCreate)
  RunDiagnostics inv, diagPath, tplCreate, tplFolder, fso, gDwgTemplatePath
  RestoreInventorUi inv
  WScript.Echo "DIAG DONE"
  WScript.Quit 0
End If

Function IsOldVersionsFolderName(folderName)
  IsOldVersionsFolderName = (LCase(Trim(folderName)) = "oldversions")
End Function

' Inventor stores prior saves as BaseName.0001.ipt, Z1600750.0010.ipt, etc. — not production parts; do not draw these.
Function IsInventorOldVersionStyleIptBaseName(baseNm)
  Dim dotPos, suffix, i, ch, allDig
  On Error Resume Next
  IsInventorOldVersionStyleIptBaseName = False
  dotPos = InStrRev(baseNm, ".")
  If dotPos <= 0 Then Exit Function
  suffix = Mid(baseNm, dotPos + 1)
  If Len(suffix) < 3 Or Len(suffix) > 8 Then Exit Function
  allDig = True
  For i = 1 To Len(suffix)
    ch = Mid(suffix, i, 1)
    If ch < "0" Or ch > "9" Then allDig = False
  Next
  If allDig Then IsInventorOldVersionStyleIptBaseName = True
End Function

' Reduces backup copies under .\OldVersions\ on each Save (0 = none; API path may differ by Inventor version).
Sub TrySetOldVersionsKeep(inv, keepCount)
  On Error Resume Next
  inv.FileOptions.SaveOptions.OldVersionsToKeepOnSave = keepCount
  If Err.Number = 0 Then
    WScript.Echo "SaveOptions: OldVersionsToKeepOnSave set to " & keepCount
  End If
  Err.Clear
End Sub

Function CountIptRecursive(fso, folderPath)
  Dim folder, f, sf, n
  On Error Resume Next
  n = 0
  Set folder = fso.GetFolder(folderPath)
  For Each f In folder.Files
    If LCase(fso.GetExtensionName(f.Name)) = "ipt" Then
      If Not IsInventorOldVersionStyleIptBaseName(fso.GetBaseName(f.Name)) Then n = n + 1
    End If
  Next
  For Each sf In folder.SubFolders
    If ALLOW_SCAN_OLDVERSIONS Or Not IsOldVersionsFolderName(sf.Name) Then
      n = n + CountIptRecursive(fso, sf.Path)
    End If
  Next
  CountIptRecursive = n
End Function

' Skip if a drawing already exists: same folder as the .ipt, same base name.
' When batch output is .dwg, also skip if a sibling .idw exists (DWG often falls back to .idw; avoids wiping dimensioned idw).
Function DrawingAlreadyExists(fso, iptParent, baseName, batchOutExt)
  Dim pDwg, pIdw
  On Error Resume Next
  DrawingAlreadyExists = False
  pDwg = fso.BuildPath(iptParent, baseName & ".dwg")
  pIdw = fso.BuildPath(iptParent, baseName & ".idw")
  If batchOutExt = "dwg" Then
    If fso.FileExists(pDwg) Or fso.FileExists(pIdw) Then DrawingAlreadyExists = True
  Else
    If fso.FileExists(fso.BuildPath(iptParent, baseName & "." & batchOutExt)) Then DrawingAlreadyExists = True
  End If
End Function

Sub BatchProcessFolderRecursive(inv, folderPath, fso, drawTpl, batchOutExt)
  Dim folder, f, sf, baseName, outPath, parentFolder, idwPath, dwgPath
  On Error Resume Next
  Set folder = fso.GetFolder(folderPath)
  For Each f In folder.Files
    If LCase(fso.GetExtensionName(f.Name)) = "ipt" Then
      baseName = fso.GetBaseName(f.Path)
      If IsInventorOldVersionStyleIptBaseName(baseName) Then
        gBatchSkipBackupIpt = gBatchSkipBackupIpt + 1
        WScript.Echo "SKIP Inventor backup .ipt (not production; name ends with .####): " & f.Path
      ElseIf (Not ALLOW_SCAN_OLDVERSIONS) And IsOldVersionsFolderName(fso.GetFileName(fso.GetParentFolderName(f.Path))) Then
        gBatchSkipOldVersionsIpt = gBatchSkipOldVersionsIpt + 1
        WScript.Echo "SKIP .ipt under OldVersions (set ALLOW_SCAN_OLDVERSIONS=True or move .ipt): " & f.Path
      Else
      parentFolder = fso.GetParentFolderName(f.Path)
      outPath = fso.BuildPath(parentFolder, baseName & "." & batchOutExt)
      idwPath = fso.BuildPath(parentFolder, baseName & ".idw")
      dwgPath = fso.BuildPath(parentFolder, baseName & ".dwg")
      If Not OVERWRITE_EXISTING_DRAWINGS And DrawingAlreadyExists(fso, parentFolder, baseName, batchOutExt) Then
        gBatchSkipExists = gBatchSkipExists + 1
        If batchOutExt = "dwg" And fso.FileExists(idwPath) And Not fso.FileExists(dwgPath) Then
          WScript.Echo "SKIP exists: " & idwPath & " (.dwg output not present; skipping to avoid overwriting .idw)"
        Else
          WScript.Echo "SKIP exists: " & outPath
        End If
      Else
        ProcessPart inv, f.Path, drawTpl, outPath, fso
      End If
    End If
    End If
  Next
  For Each sf In folder.SubFolders
    If ALLOW_SCAN_OLDVERSIONS Or Not IsOldVersionsFolderName(sf.Name) Then
      BatchProcessFolderRecursive inv, sf.Path, fso, drawTpl, batchOutExt
    End If
  Next
End Sub

iptCount = CountIptRecursive(fso, partsScanFolder)
WScript.Echo "Batch: scan folder (recursive)=" & partsScanFolder
WScript.Echo "Batch: .ipt count (all subfolders)=" & iptCount & "  output *." & batchOutExt & " next to each .ipt"
If iptCount = 0 Then
  WScript.Echo "ERROR: No .ipt files found under the scan folder."
  WScript.Echo "       Set VARIANTS_FOLDER to the full path of the folder that contains your parts, or move .ipt files into PARTS_FOLDER."
  RestoreInventorUi inv
  WScript.Quit 2
End If
If iptCount <= 1 Then
  WScript.Echo "HINT: Count above = total production .ipt under scan folder (recursive). Script visits ALL of them, not just the first."
  WScript.Echo "      If you expected many parts, set VARIANTS_FOLDER (in double quotes) to the folder that contains all Z*.ipt files."
End If
If Not OVERWRITE_EXISTING_DRAWINGS Then
  WScript.Echo "Batch: SKIP exists = that part already has a drawing next to it. Run with: cscript //nologo batch_part_drawings.vbs overwrite"
  WScript.Echo "       Or set OVERWRITE_EXISTING_DRAWINGS=True in this script (replaces *.idw / *.dwg for batch output ext)."
End If
WScript.Echo "Batch: starting pass over each .ipt..."
BatchProcessFolderRecursive inv, partsScanFolder, fso, tplCreate, batchOutExt

RestoreInventorUi inv
WScript.Echo "Batch summary: OK drawings=" & gBatchDrawingOk & "  SKIP exists=" & gBatchSkipExists & "  SKIP backup.ipt=" & gBatchSkipBackupIpt & "  SKIP OldVersions folder .ipt=" & gBatchSkipOldVersionsIpt
WScript.Echo "DONE"
