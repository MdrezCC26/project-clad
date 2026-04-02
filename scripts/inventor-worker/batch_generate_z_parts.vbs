' Generate Z-bar .ipt variants from one seed part.
' Part name: Z{gauge}{d18_thousandths}  e.g. Z1600750 = gauge 16, d18_length = 0.750 in
' Sets: d18_length; Gauge_dec (thickness in); optional text param Gauge = "16" / "22" (number only).
' iProperties: Summary Title = "Z BAR 0.75" (Inventor Document Summary or Inventor Summary Information); custom Gauge = "16".
'
' Edit SEED_IPT, OUTPUT_FOLDER, INVENTOR_PROJECT below.
' Then: cscript //nologo batch_generate_z_parts.vbs
' After parts exist, run batch_part_drawings.vbs for drawings.
'
' Requires: seed .ipt with d18_length, Gauge_dec (optional text parameter Gauge).

Option Explicit

Dim SEED_IPT, OUTPUT_FOLDER, INVENTOR_PROJECT
SEED_IPT = "C:\Users\Micha\Desktop\Canadian Cladding\DRAWINGS & MODELS\Z Bars\Z1600750.ipt"
OUTPUT_FOLDER = "C:\Users\Micha\Desktop\Canadian Cladding\DRAWINGS & MODELS\Z Bars"
INVENTOR_PROJECT = ""

' d18_length range (inches), step 1/8"
Const D18_MIN_THOU = 750    ' 0.750
Const D18_MAX_THOU = 6000   ' 6.000
Const D18_STEP_THOU = 125   ' 0.125

' Skip if target .ipt already exists (protects hand-edited files).
Dim SKIP_EXISTING_PARTS
SKIP_EXISTING_PARTS = True

' Set True to replace existing Z*.ipt in OUTPUT_FOLDER for generated names only.
Dim OVERWRITE_EXISTING_PARTS
OVERWRITE_EXISTING_PARTS = False

' User parameter names on the seed (must match Inventor exactly).
Const PARAM_D18 = "d18_length"
Const PARAM_GAUGE_DEC = "Gauge_dec"
Const PARAM_GAUGE_TEXT = "Gauge"

' iProperty custom field name (must match your title block / drawing field).
Const IPROP_GAUGE_NAME = "Gauge"

' Gauge numbers in the filename + thickness (in) for Gauge_dec.
Dim GAUGE_NUMS, GAUGE_THICK_IN
GAUGE_NUMS = Array(16, 18, 20, 22)
GAUGE_THICK_IN = Array(0.0598, 0.0478, 0.0359, 0.0299)

Sub Fail(msg)
  WScript.Echo "FATAL: " & msg
  WScript.Quit 1
End Sub

Function Pad5Thou(n)
  Pad5Thou = Right("00000" & CStr(n), 5)
End Function

' Inventor expressions need a plain decimal point (avoid locale commas from FormatNumber).
Function InchExpr(val)
  Dim s
  s = CStr(Round(val, 6))
  s = Replace(s, ",", ".")
  InchExpr = s & " in"
End Function

' Title text: "Z BAR 0.75", "Z BAR 1.125", "Z BAR 6" (trims trailing zeros).
Function ZBarTitleFromThou(thou)
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
  ZBarTitleFromThou = "Z BAR " & s
End Function

Function GaugeLabelFromNum(gNum)
  GaugeLabelFromNum = CStr(gNum)
End Function

' Text user parameter: Inventor expression is quoted string, e.g. "16"
Function SetUserParamTextLiteral(partDoc, paramName, literalText, ByRef errNum, ByRef errDesc)
  Dim exprQuoted
  On Error Resume Next
  SetUserParamTextLiteral = False
  errNum = 0
  errDesc = ""
  exprQuoted = Chr(34) & Replace(literalText, Chr(34), "'") & Chr(34)
  If Not SetUserParamExpression(partDoc, paramName, exprQuoted, errNum, errDesc) Then Exit Function
  SetUserParamTextLiteral = True
End Function

' Summary "Title" (iProperties dialog Summary tab). Some builds use Inventor Summary Information.
Sub TrySetDocumentSummaryTitle(doc, titleText)
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

' Custom iProperty (e.g. for drawing title block "Gauge" field).
Sub TrySetUserDefinedProperty(doc, propName, propValue)
  Dim ps, it
  On Error Resume Next
  Set ps = doc.PropertySets.Item("Inventor User Defined Properties")
  If Err.Number <> 0 Then
    Err.Clear
    Exit Sub
  End If
  Set it = ps.Item(propName)
  If Err.Number = 0 Then
    it.Value = propValue
    Err.Clear
    Exit Sub
  End If
  Err.Clear
  ps.Add propValue, propName
  If Err.Number <> 0 Then
    Err.Clear
    ps.Add propName, propValue
  End If
  Err.Clear
End Sub

Sub ApplyTitleAndGaugeIProperties(doc, titleText, gaugeLabel)
  TrySetDocumentSummaryTitle doc, titleText
  TrySetUserDefinedProperty doc, IPROP_GAUGE_NAME, gaugeLabel
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

Sub MaybeActivateProject(inv, fso, ipjPath)
  Dim adp, prjDoc
  ipjPath = Trim(ipjPath)
  If Len(ipjPath) = 0 Then Exit Sub
  If Not fso.FileExists(ipjPath) Then
    WScript.Echo "WARN: INVENTOR_PROJECT not found: " & ipjPath
    Exit Sub
  End If
  On Error Resume Next
  adp = inv.DesignProjectManager.ActiveDesignProject.FullFileName
  Err.Clear
  If LCase(Replace(adp, "/", "\")) = LCase(Replace(ipjPath, "/", "\")) Then Exit Sub
  Call inv.DesignProjectManager.DesignProjects.Open(ipjPath, True)
  If Err.Number = 0 Then
    WScript.Echo "OK   Activated project: " & ipjPath
    Err.Clear
    Exit Sub
  End If
  Err.Clear
  Call inv.DesignProjectManager.DesignProjects.Open(ipjPath)
  If Err.Number = 0 Then Exit Sub
  Err.Clear
  Set prjDoc = inv.Documents.Open(ipjPath, True)
  If Err.Number = 0 Then WScript.Echo "OK   Opened project: " & ipjPath
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

' Set a user parameter by expression string (e.g. "0.75 in") — works with unit-aware params.
Function SetUserParamExpression(partDoc, paramName, exprText, ByRef errNum, ByRef errDesc)
  Dim params, up
  On Error Resume Next
  SetUserParamExpression = False
  errNum = 0
  errDesc = ""
  Set params = partDoc.ComponentDefinition.Parameters
  If Err.Number <> 0 Then
    errNum = Err.Number
    errDesc = Err.Description
    Exit Function
  End If
  Err.Clear
  Set up = params.UserParameters.Item(paramName)
  If Err.Number <> 0 Then
    errNum = Err.Number
    errDesc = Err.Description
    Exit Function
  End If
  Err.Clear
  up.Expression = exprText
  If Err.Number <> 0 Then
    errNum = Err.Number
    errDesc = Err.Description
    Exit Function
  End If
  SetUserParamExpression = True
End Function

Sub MainGenerate
  Dim fso, inv, seedPath, outFolder, ipj, doc
  Dim thou, gi, gNum, thickIn, d18In, baseName, outPath
  Dim skipped, written, failed, skipThis
  Dim errN, errD, exprD18, exprDec, gaugeLbl, titleTxt

  Set fso = CreateObject("Scripting.FileSystemObject")
  seedPath = Trim(SEED_IPT)
  outFolder = Trim(OUTPUT_FOLDER)

  If Not fso.FileExists(seedPath) Then Fail("SEED_IPT not found: " & seedPath)
  If Not fso.FolderExists(outFolder) Then Fail("OUTPUT_FOLDER not found: " & outFolder)

  If UBound(GAUGE_NUMS) <> UBound(GAUGE_THICK_IN) Then Fail("GAUGE_NUMS / GAUGE_THICK_IN length mismatch")

  ipj = Trim(INVENTOR_PROJECT)
  If Len(ipj) = 0 Then ipj = FirstIpjInFolder(fso, outFolder)

  On Error Resume Next
  Set inv = CreateObject("Inventor.Application")
  If Err.Number <> 0 Then Fail("CreateObject(Inventor.Application): " & Err.Number & " " & Err.Description)
  inv.Visible = True
  RestoreInventorUi inv
  inv.SilentOperation = True
  Err.Clear
  inv.UserInterfaceManager.UserInteractionDisabled = True
  Err.Clear

  MaybeActivateProject inv, fso, ipj

  WScript.Echo "Generate Z parts: seed=" & seedPath
  WScript.Echo "Output folder=" & outFolder
  WScript.Echo "d18 thousandths: " & D18_MIN_THOU & " to " & D18_MAX_THOU & " step " & D18_STEP_THOU
  WScript.Echo "Gauges: " & JoinGaugeList()
  WScript.Echo "SKIP_EXISTING_PARTS=" & SKIP_EXISTING_PARTS & "  OVERWRITE_EXISTING_PARTS=" & OVERWRITE_EXISTING_PARTS

  skipped = 0
  written = 0
  failed = 0

  For thou = D18_MIN_THOU To D18_MAX_THOU Step D18_STEP_THOU
    d18In = thou / 1000.0
    exprD18 = InchExpr(d18In)
    For gi = 0 To UBound(GAUGE_NUMS)
      gNum = GAUGE_NUMS(gi)
      thickIn = GAUGE_THICK_IN(gi)
      exprDec = InchExpr(thickIn)
      gaugeLbl = GaugeLabelFromNum(gNum)
      titleTxt = ZBarTitleFromThou(thou)
      baseName = "Z" & CStr(gNum) & Pad5Thou(thou)
      outPath = fso.BuildPath(outFolder, baseName & ".ipt")

      skipThis = False
      If fso.FileExists(outPath) Then
        If SKIP_EXISTING_PARTS And Not OVERWRITE_EXISTING_PARTS Then
          skipThis = True
        End If
      End If
      If skipThis Then
        WScript.Echo "SKIP exists: " & outPath
        skipped = skipped + 1
      Else
        Err.Clear
        Set doc = inv.Documents.Open(seedPath, False)
        If Err.Number <> 0 Or doc Is Nothing Then
          WScript.Echo "SKIP open seed: " & Err.Number & " " & Err.Description
          failed = failed + 1
        Else
          If Not SetUserParamExpression(doc, PARAM_D18, exprD18, errN, errD) Then
            WScript.Echo "SKIP param " & PARAM_D18 & ": " & errN & " " & errD
            doc.Close False
            failed = failed + 1
          ElseIf Not SetUserParamExpression(doc, PARAM_GAUGE_DEC, exprDec, errN, errD) Then
            WScript.Echo "SKIP param " & PARAM_GAUGE_DEC & ": " & errN & " " & errD
            doc.Close False
            failed = failed + 1
          Else
            If Not SetUserParamTextLiteral(doc, PARAM_GAUGE_TEXT, gaugeLbl, errN, errD) Then
              WScript.Echo "WARN user param """ & PARAM_GAUGE_TEXT & """ not set for " & baseName & ": " & errN & " " & errD
              Err.Clear
            End If
            ApplyTitleAndGaugeIProperties doc, titleTxt, gaugeLbl
            Err.Clear
            doc.Update2 True
            If Err.Number <> 0 Then
              WScript.Echo "WARN Update2: " & Err.Number & " " & Err.Description
              Err.Clear
            End If
            Err.Clear
            doc.SaveAs outPath, False
            If Err.Number <> 0 Then
              WScript.Echo "SKIP SaveAs " & outPath & ": " & Err.Number & " " & Err.Description
              doc.Close False
              failed = failed + 1
            Else
              WScript.Echo "OK   " & outPath
              doc.Close False
              written = written + 1
            End If
          End If
        End If
      End If
    Next
  Next

  RestoreInventorUi inv
  WScript.Echo "DONE  written=" & written & " skipped=" & skipped & " failed=" & failed
End Sub

Function JoinGaugeList()
  Dim i, s
  s = ""
  For i = 0 To UBound(GAUGE_NUMS)
    If Len(s) > 0 Then s = s & ", "
    s = s & CStr(GAUGE_NUMS(i)) & "=" & CStr(GAUGE_THICK_IN(i)) & "in"
  Next
  JoinGaugeList = s
End Function

MainGenerate
