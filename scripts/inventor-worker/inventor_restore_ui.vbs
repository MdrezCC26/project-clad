' Restore Inventor ribbon/menus after batch_part_drawings.vbs (SilentOperation + UserInteractionDisabled).
' Run while Inventor is open from the inventor-worker folder:
'   cscript //nologo inventor_restore_ui.vbs
' If Inventor was started by a batch script, this attaches to that same session and clears the flags.
Option Explicit

Dim inv
On Error Resume Next
Set inv = GetObject(, "Inventor.Application")
If inv Is Nothing Then
  WScript.Echo "No running Inventor session found; starting Inventor.Application..."
  Set inv = CreateObject("Inventor.Application")
End If
If inv Is Nothing Then
  WScript.Echo "FAIL: Could not get Inventor.Application"
  WScript.Quit 1
End If

inv.Visible = True
inv.SilentOperation = False
inv.UserInterfaceManager.UserInteractionDisabled = False
Err.Clear

WScript.Echo "OK: Inventor UI automation flags cleared (SilentOperation off, user input on)."
WScript.Echo "If the ribbon is still missing: click in Inventor and press Ctrl+F1, or right-click the ribbon/title area and uncheck Minimize the Ribbon."
WScript.Quit 0
