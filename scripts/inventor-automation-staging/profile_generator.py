"""
Canadian Cladding Profile Generator
Main GUI Application (PyQt5)

Automates Autodesk Inventor shop drawing generation for cladding profiles.
"""

import sys
import os
import json
import math
from typing import Optional, List, Dict, Any

from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QWidget, QTabWidget, QVBoxLayout,
    QHBoxLayout, QGridLayout, QLabel, QLineEdit, QComboBox,
    QPushButton, QCheckBox, QTextEdit, QProgressBar, QGroupBox,
    QFileDialog, QMessageBox, QSpinBox, QDoubleSpinBox, QListWidget,
    QListWidgetItem, QSplitter, QFrame, QScrollArea
)
from PyQt5.QtCore import Qt, QThread, pyqtSignal, QSettings
from PyQt5.QtGui import QFont, QColor, QPalette, QIcon, QTextCursor

from inventor_automation import InventorAutomation, PartParameters, GenerationResult


# ──────────────────────────────────────────────
#  Worker Thread
# ──────────────────────────────────────────────

class GenerationWorker(QThread):
    """Background worker that calls Inventor without blocking the GUI."""

    progress   = pyqtSignal(int)            # 0–100
    log        = pyqtSignal(str)            # log message
    finished   = pyqtSignal(list)           # list[GenerationResult]
    error      = pyqtSignal(str)            # fatal error string

    def __init__(self, params_list: List[PartParameters], output_dir: str,
                 export_pdf: bool, export_dxf: bool, export_png: bool,
                 test_mode: bool = False):
        super().__init__()
        self.params_list = params_list
        self.output_dir  = output_dir
        self.export_pdf  = export_pdf
        self.export_dxf  = export_dxf
        self.export_png  = export_png
        self.test_mode   = test_mode

    def run(self):
        results: List[GenerationResult] = []
        total   = len(self.params_list)

        if self.test_mode:
            self._run_test_mode(results, total)
            return

        try:
            automation = InventorAutomation(log_callback=self.log.emit)
            if not automation.connect():
                self.error.emit("Could not connect to Autodesk Inventor.\n"
                                "Make sure Inventor is installed, or enable Test Mode in Settings.")
                return

            for idx, params in enumerate(self.params_list, 1):
                self.log.emit(f"\n[{idx}/{total}] Generating: {params.part_number}")
                result = automation.generate_part(
                    params      = params,
                    output_dir  = self.output_dir,
                    export_pdf  = self.export_pdf,
                    export_dxf  = self.export_dxf,
                    export_png  = self.export_png,
                )
                results.append(result)
                self.progress.emit(int(idx / total * 100))

            automation.disconnect()

        except Exception as exc:
            self.error.emit(str(exc))
            return

        self.finished.emit(results)

    def _run_test_mode(self, results: List[GenerationResult], total: int):
        """Simulate generation without real Inventor calls."""
        import time
        for idx, params in enumerate(self.params_list, 1):
            self.log.emit(f"\n[TEST {idx}/{total}] Simulating: {params.part_number}")
            self.log.emit(f"  Template : {params.template_name}")
            self.log.emit(f"  L1={params.L1}\"  L2={params.L2}\"  L3={params.L3}\"")
            self.log.emit(f"  A1={params.A1}°  A2={params.A2}°  Gauge={params.gauge}")
            self.log.emit(f"  Total Length={params.total_length}\"")
            self.log.emit(f"  Outputs → PDF:{self.export_pdf}  DXF:{self.export_dxf}  PNG:{self.export_png}")
            self.log.emit(f"  ✓ [TEST] Part generated (no files written)")
            time.sleep(0.3)
            self.progress.emit(int(idx / total * 100))
            results.append(GenerationResult(
                part_number = params.part_number,
                success     = True,
                message     = "Test mode – no files written",
            ))
        self.finished.emit(results)


# ──────────────────────────────────────────────
#  Main Window
# ──────────────────────────────────────────────

class ProfileGeneratorWindow(QMainWindow):
    """Main application window."""

    def __init__(self):
        super().__init__()
        self.setWindowTitle("Canadian Cladding Profile Generator")
        self.setMinimumSize(900, 700)
        self.resize(1050, 780)

        self.settings   = QSettings("CanadianCladding", "ProfileGenerator")
        self.config     = self._load_config()
        self.worker: Optional[GenerationWorker] = None

        self._init_ui()
        self._apply_stylesheet()
        self._restore_settings()

    # ── Config ──────────────────────────────────

    def _load_config(self) -> Dict[str, Any]:
        cfg_path = os.path.join(os.path.dirname(__file__), "config.json")
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            QMessageBox.warning(self, "Config Missing",
                                f"config.json not found at:\n{cfg_path}\n\nUsing defaults.")
            return {"templates": [], "default_output_dir": os.path.expanduser("~/Desktop/CladOutput")}
        except json.JSONDecodeError as e:
            QMessageBox.critical(self, "Config Error", f"Invalid config.json:\n{e}")
            return {"templates": [], "default_output_dir": os.path.expanduser("~/Desktop/CladOutput")}

    # ── UI Construction ─────────────────────────

    def _init_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root_layout = QVBoxLayout(central)
        root_layout.setContentsMargins(8, 8, 8, 8)
        root_layout.setSpacing(6)

        # Header
        header = self._make_header()
        root_layout.addWidget(header)

        # Tabs
        self.tabs = QTabWidget()
        self.tabs.addTab(self._make_single_tab(),   "⚙  Single Part")
        self.tabs.addTab(self._make_batch_tab(),    "⚡  Batch Generate")
        self.tabs.addTab(self._make_settings_tab(), "🔧  Settings")
        root_layout.addWidget(self.tabs, stretch=1)

        # Log
        root_layout.addWidget(self._make_log_panel())

        # Status bar
        self.statusBar().showMessage("Ready")

    def _make_header(self) -> QWidget:
        frame = QFrame()
        frame.setObjectName("header")
        layout = QHBoxLayout(frame)
        layout.setContentsMargins(12, 8, 12, 8)

        title = QLabel("🍁 Canadian Cladding Profile Generator")
        title.setObjectName("headerTitle")
        subtitle = QLabel("Autodesk Inventor Shop Drawing Automation")
        subtitle.setObjectName("headerSubtitle")

        layout.addWidget(title)
        layout.addStretch()
        layout.addWidget(subtitle)
        return frame

    # ── Single Part Tab ──────────────────────────

    def _make_single_tab(self) -> QWidget:
        w = QWidget()
        layout = QHBoxLayout(w)
        layout.setContentsMargins(10, 10, 10, 10)

        # Left: inputs
        left = QVBoxLayout()
        left.setSpacing(8)

        # Template selection
        tpl_group = QGroupBox("Template")
        tpl_layout = QHBoxLayout(tpl_group)
        self.single_template_combo = QComboBox()
        for t in self.config.get("templates", []):
            self.single_template_combo.addItem(t["name"], t)
        tpl_layout.addWidget(self.single_template_combo)
        left.addWidget(tpl_group)

        # Dimensions
        dim_group = QGroupBox("Dimensions (inches / degrees)")
        dim_grid  = QGridLayout(dim_group)
        self.single_inputs: Dict[str, QDoubleSpinBox] = {}
        fields = [
            ("L1", "Flange 1 (in)",    0.5, 20.0, 3),
            ("L2", "Web (in)",          0.5, 24.0, 6),
            ("L3", "Flange 3 (in)",     0.5, 20.0, 3),
            ("A1", "Angle 1 (°)",       0.0, 180.0, 90),
            ("A2", "Angle 2 (°)",       0.0, 180.0, 90),
            ("Gauge", "Gauge",          1,   22,    16),
            ("TotalLength", "Length (in)", 12, 480, 120),
        ]
        for row, (key, label, lo, hi, default) in enumerate(fields):
            lbl  = QLabel(label + ":")
            spin = QDoubleSpinBox()
            spin.setRange(lo, hi)
            spin.setValue(default)
            spin.setDecimals(3 if key not in ("Gauge",) else 0)
            spin.setSingleStep(0.125 if key not in ("A1","A2","Gauge") else 1)
            if key == "Gauge":
                spin.setDecimals(0)
            dim_grid.addWidget(lbl,  row, 0)
            dim_grid.addWidget(spin, row, 1)
            self.single_inputs[key] = spin
        left.addWidget(dim_group)

        # Part number preview
        pn_group = QGroupBox("Part Number Preview")
        pn_layout = QHBoxLayout(pn_group)
        self.single_pn_label = QLabel("—")
        self.single_pn_label.setObjectName("partNumberLabel")
        pn_layout.addWidget(self.single_pn_label)
        left.addWidget(pn_group)
        for spin in self.single_inputs.values():
            spin.valueChanged.connect(self._update_single_pn_preview)
        self.single_template_combo.currentIndexChanged.connect(self._update_single_pn_preview)
        self._update_single_pn_preview()

        # Outputs
        out_group = QGroupBox("Export Outputs")
        out_layout = QHBoxLayout(out_group)
        self.single_pdf = QCheckBox("PDF Shop Drawing")
        self.single_dxf = QCheckBox("DXF Flat Pattern")
        self.single_png = QCheckBox("PNG Thumbnail")
        self.single_pdf.setChecked(True)
        self.single_dxf.setChecked(True)
        out_layout.addWidget(self.single_pdf)
        out_layout.addWidget(self.single_dxf)
        out_layout.addWidget(self.single_png)
        left.addWidget(out_group)

        # Generate
        self.single_generate_btn = QPushButton("▶  Generate Part")
        self.single_generate_btn.setObjectName("generateBtn")
        self.single_generate_btn.clicked.connect(self._on_single_generate)
        left.addWidget(self.single_generate_btn)
        left.addStretch()

        layout.addLayout(left, stretch=2)
        layout.addWidget(self._make_vsep())
        return w

    def _update_single_pn_preview(self):
        tpl_data = self.single_template_combo.currentData()
        if not tpl_data:
            self.single_pn_label.setText("—")
            return
        code  = tpl_data.get("profile_code", "X")
        gauge = int(self.single_inputs["Gauge"].value())
        L1    = self.single_inputs["L1"].value()
        pn    = f"{code}{gauge:02d}00{int(round(L1 * 1000))}"
        self.single_pn_label.setText(pn)

    def _on_single_generate(self):
        tpl_data = self.single_template_combo.currentData()
        if not tpl_data:
            QMessageBox.warning(self, "No Template", "Please select a template first.")
            return

        params = PartParameters(
            template_name  = tpl_data["name"],
            part_file      = tpl_data.get("part_file", ""),
            drawing_file   = tpl_data.get("drawing_file", ""),
            profile_code   = tpl_data.get("profile_code", "X"),
            L1             = self.single_inputs["L1"].value(),
            L2             = self.single_inputs["L2"].value(),
            L3             = self.single_inputs["L3"].value(),
            A1             = self.single_inputs["A1"].value(),
            A2             = self.single_inputs["A2"].value(),
            gauge          = int(self.single_inputs["Gauge"].value()),
            total_length   = self.single_inputs["TotalLength"].value(),
        )

        self._start_worker(
            [params],
            export_pdf = self.single_pdf.isChecked(),
            export_dxf = self.single_dxf.isChecked(),
            export_png = self.single_png.isChecked(),
        )

    # ── Batch Tab ────────────────────────────────

    def _make_batch_tab(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(10, 10, 10, 10)

        top = QHBoxLayout()

        # Template
        tpl_group = QGroupBox("Template")
        tpl_layout = QHBoxLayout(tpl_group)
        self.batch_template_combo = QComboBox()
        for t in self.config.get("templates", []):
            self.batch_template_combo.addItem(t["name"], t)
        tpl_layout.addWidget(self.batch_template_combo)
        top.addWidget(tpl_group, 1)

        # Gauge selector
        gauge_group = QGroupBox("Gauges")
        gauge_layout = QVBoxLayout(gauge_group)
        self.batch_gauge_list = QListWidget()
        self.batch_gauge_list.setFixedHeight(80)
        for g in [14, 16, 20]:
            item = QListWidgetItem(f"Gauge {g}")
            item.setData(Qt.UserRole, g)
            item.setCheckState(Qt.Checked if g == 16 else Qt.Unchecked)
            self.batch_gauge_list.addItem(item)
        gauge_layout.addWidget(self.batch_gauge_list)
        top.addWidget(gauge_group, 1)

        layout.addLayout(top)

        # Ranges
        range_group = QGroupBox("Dimension Ranges (inches / degrees)")
        range_grid  = QGridLayout(range_group)
        range_grid.addWidget(QLabel("Parameter"), 0, 0)
        range_grid.addWidget(QLabel("Min"),        0, 1)
        range_grid.addWidget(QLabel("Max"),        0, 2)
        range_grid.addWidget(QLabel("Step"),       0, 3)

        self.batch_ranges: Dict[str, Dict[str, QDoubleSpinBox]] = {}
        range_params = [
            ("L1", "Flange 1", 0.5, 6.0,  0.5,  0.5, 3.0,  0.5),
            ("L2", "Web",      1.0, 24.0, 0.5,  4.0, 10.0, 1.0),
            ("L3", "Flange 3", 0.5, 6.0,  0.5,  0.5, 3.0,  0.5),
            ("TotalLength", "Length", 24, 480, 12, 120, 240, 12),
        ]
        for row, (key, label, lo, hi, step, def_min, def_max, def_step) in enumerate(range_params, 1):
            range_grid.addWidget(QLabel(label + ":"), row, 0)
            spins = {}
            for col, (skey, sdef) in enumerate(
                [("min", def_min), ("max", def_max), ("step", def_step)], 1
            ):
                sp = QDoubleSpinBox()
                sp.setRange(lo, hi)
                sp.setValue(sdef)
                sp.setSingleStep(step)
                sp.setDecimals(3)
                sp.valueChanged.connect(self._update_batch_count)
                range_grid.addWidget(sp, row, col)
                spins[skey] = sp
            self.batch_ranges[key] = spins

        layout.addWidget(range_group)

        # Options
        opt_group = QGroupBox("Options")
        opt_layout = QHBoxLayout(opt_group)
        self.batch_symmetric = QCheckBox("Symmetric Flanges (L1 = L3)")
        self.batch_symmetric.setChecked(True)
        self.batch_symmetric.stateChanged.connect(self._update_batch_count)
        self.batch_pdf = QCheckBox("PDF")
        self.batch_dxf = QCheckBox("DXF")
        self.batch_png = QCheckBox("PNG")
        self.batch_pdf.setChecked(True)
        self.batch_dxf.setChecked(True)
        opt_layout.addWidget(self.batch_symmetric)
        opt_layout.addWidget(self.batch_pdf)
        opt_layout.addWidget(self.batch_dxf)
        opt_layout.addWidget(self.batch_png)
        opt_layout.addStretch()
        self.batch_count_label = QLabel("Estimated parts: 0")
        self.batch_count_label.setObjectName("batchCount")
        opt_layout.addWidget(self.batch_count_label)
        layout.addWidget(opt_group)

        # Progress
        self.batch_progress = QProgressBar()
        self.batch_progress.setValue(0)
        layout.addWidget(self.batch_progress)

        # Buttons
        btn_layout = QHBoxLayout()
        self.batch_generate_btn = QPushButton("⚡  Batch Generate")
        self.batch_generate_btn.setObjectName("generateBtn")
        self.batch_generate_btn.clicked.connect(self._on_batch_generate)
        btn_layout.addStretch()
        btn_layout.addWidget(self.batch_generate_btn)
        layout.addLayout(btn_layout)

        self._update_batch_count()
        return w

    def _update_batch_count(self):
        try:
            count = len(self._build_batch_params_list(dry_run=True))
            self.batch_count_label.setText(f"Estimated parts: {count}")
        except Exception:
            self.batch_count_label.setText("Estimated parts: ?")

    def _build_batch_params_list(self, dry_run: bool = False) -> List[PartParameters]:
        import numpy as np

        def arange(lo, hi, step):
            if step <= 0:
                step = 1
            vals = []
            v = lo
            while v <= hi + 1e-9:
                vals.append(round(v, 4))
                v += step
            return vals

        tpl_data = self.batch_template_combo.currentData()
        if not tpl_data and not dry_run:
            return []

        gauges = []
        for i in range(self.batch_gauge_list.count()):
            item = self.batch_gauge_list.item(i)
            if item.checkState() == Qt.Checked:
                gauges.append(item.data(Qt.UserRole))
        if not gauges:
            gauges = [16]

        symmetric = self.batch_symmetric.isChecked()
        L1_vals   = arange(*[self.batch_ranges["L1"][k].value() for k in ("min","max","step")])
        L2_vals   = arange(*[self.batch_ranges["L2"][k].value() for k in ("min","max","step")])
        L3_vals   = arange(*[self.batch_ranges["L3"][k].value() for k in ("min","max","step")])
        TL_vals   = arange(*[self.batch_ranges["TotalLength"][k].value() for k in ("min","max","step")])

        params_list = []
        for g in gauges:
            for l1 in L1_vals:
                for l2 in L2_vals:
                    for tl in TL_vals:
                        if symmetric:
                            combos = [(l1,)]
                        else:
                            combos = [(l3,) for l3 in L3_vals]
                        for (l3,) in combos:
                            _l3 = l1 if symmetric else l3
                            if dry_run:
                                params_list.append(object())  # just count
                            else:
                                code = tpl_data.get("profile_code", "X")
                                pn   = f"{code}{g:02d}00{int(round(l1*1000))}"
                                params_list.append(PartParameters(
                                    template_name = tpl_data["name"],
                                    part_file     = tpl_data.get("part_file", ""),
                                    drawing_file  = tpl_data.get("drawing_file", ""),
                                    profile_code  = code,
                                    L1=l1, L2=l2, L3=_l3,
                                    A1=90.0, A2=90.0,
                                    gauge=g, total_length=tl,
                                ))
        return params_list

    def _on_batch_generate(self):
        tpl_data = self.batch_template_combo.currentData()
        if not tpl_data:
            QMessageBox.warning(self, "No Template", "Please select a template.")
            return
        params_list = self._build_batch_params_list(dry_run=False)
        if not params_list:
            QMessageBox.information(self, "Nothing to Generate",
                                    "No parameter combinations found. Check ranges.")
            return
        confirm = QMessageBox.question(
            self, "Confirm Batch",
            f"Generate {len(params_list)} parts?\nThis may take a while.",
            QMessageBox.Yes | QMessageBox.No
        )
        if confirm != QMessageBox.Yes:
            return
        self._start_worker(
            params_list,
            export_pdf = self.batch_pdf.isChecked(),
            export_dxf = self.batch_dxf.isChecked(),
            export_png = self.batch_png.isChecked(),
        )

    # ── Settings Tab ─────────────────────────────

    def _make_settings_tab(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(10)

        # Output directory
        out_group = QGroupBox("Output Directory")
        out_layout = QHBoxLayout(out_group)
        self.output_dir_edit = QLineEdit(
            self.config.get("default_output_dir",
                            os.path.expanduser("~/Desktop/CladOutput"))
        )
        browse_btn = QPushButton("Browse…")
        browse_btn.clicked.connect(self._browse_output_dir)
        out_layout.addWidget(self.output_dir_edit)
        out_layout.addWidget(browse_btn)
        layout.addWidget(out_group)

        # Templates directory
        tpl_group = QGroupBox("Templates Directory")
        tpl_layout = QHBoxLayout(tpl_group)
        self.template_dir_edit = QLineEdit(
            self.config.get("templates_dir",
                            os.path.join(os.path.dirname(__file__), "templates"))
        )
        tpl_browse = QPushButton("Browse…")
        tpl_browse.clicked.connect(self._browse_template_dir)
        tpl_layout.addWidget(self.template_dir_edit)
        tpl_layout.addWidget(tpl_browse)
        layout.addWidget(tpl_group)

        # Inventor options
        inv_group = QGroupBox("Inventor Options")
        inv_layout = QVBoxLayout(inv_group)
        self.test_mode_cb = QCheckBox("Test Mode (simulate without Inventor)")
        self.test_mode_cb.setChecked(self.settings.value("test_mode", "false") == "true")
        self.visible_cb   = QCheckBox("Show Inventor Window (slower)")
        self.visible_cb.setChecked(self.settings.value("inventor_visible", "false") == "true")
        inv_layout.addWidget(self.test_mode_cb)
        inv_layout.addWidget(self.visible_cb)
        layout.addWidget(inv_group)

        # Save settings
        save_btn = QPushButton("💾  Save Settings")
        save_btn.clicked.connect(self._save_settings)
        layout.addWidget(save_btn)
        layout.addStretch()

        # Config info
        info_group = QGroupBox("Config File")
        info_layout = QVBoxLayout(info_group)
        cfg_path = os.path.join(os.path.dirname(__file__), "config.json")
        info_layout.addWidget(QLabel(f"Path: {cfg_path}"))
        info_layout.addWidget(QLabel(f"Templates loaded: {len(self.config.get('templates', []))}"))
        layout.addWidget(info_group)

        return w

    def _browse_output_dir(self):
        path = QFileDialog.getExistingDirectory(self, "Select Output Directory",
                                                self.output_dir_edit.text())
        if path:
            self.output_dir_edit.setText(path)

    def _browse_template_dir(self):
        path = QFileDialog.getExistingDirectory(self, "Select Templates Directory",
                                                self.template_dir_edit.text())
        if path:
            self.template_dir_edit.setText(path)

    def _save_settings(self):
        self.settings.setValue("output_dir",       self.output_dir_edit.text())
        self.settings.setValue("template_dir",     self.template_dir_edit.text())
        self.settings.setValue("test_mode",        "true" if self.test_mode_cb.isChecked() else "false")
        self.settings.setValue("inventor_visible", "true" if self.visible_cb.isChecked() else "false")
        QMessageBox.information(self, "Settings", "Settings saved.")

    def _restore_settings(self):
        if self.settings.contains("output_dir"):
            self.output_dir_edit.setText(self.settings.value("output_dir"))
        if self.settings.contains("template_dir"):
            self.template_dir_edit.setText(self.settings.value("template_dir"))

    # ── Log Panel ─────────────────────────────────

    def _make_log_panel(self) -> QGroupBox:
        group = QGroupBox("Processing Log")
        group.setFixedHeight(180)
        layout = QVBoxLayout(group)
        self.log_view = QTextEdit()
        self.log_view.setReadOnly(True)
        self.log_view.setObjectName("logView")
        self.log_view.setFont(QFont("Consolas", 9))
        btn_row = QHBoxLayout()
        clear_btn = QPushButton("Clear Log")
        clear_btn.setFixedWidth(90)
        clear_btn.clicked.connect(self.log_view.clear)
        btn_row.addStretch()
        btn_row.addWidget(clear_btn)
        layout.addWidget(self.log_view)
        layout.addLayout(btn_row)
        return group

    def _make_vsep(self) -> QFrame:
        sep = QFrame()
        sep.setFrameShape(QFrame.VLine)
        sep.setFrameShadow(QFrame.Sunken)
        return sep

    # ── Worker Control ────────────────────────────

    def _start_worker(self, params_list: List[PartParameters],
                      export_pdf: bool, export_dxf: bool, export_png: bool):
        if self.worker and self.worker.isRunning():
            QMessageBox.warning(self, "Busy", "A generation job is already running.")
            return

        output_dir = self.output_dir_edit.text()
        os.makedirs(output_dir, exist_ok=True)
        test_mode  = self.test_mode_cb.isChecked()

        self.log_view.append(
            f"\n{'='*60}\n"
            f"Starting {'TEST' if test_mode else 'LIVE'} generation — {len(params_list)} part(s)\n"
            f"Output: {output_dir}\n"
            f"{'='*60}"
        )

        self.worker = GenerationWorker(
            params_list = params_list,
            output_dir  = output_dir,
            export_pdf  = export_pdf,
            export_dxf  = export_dxf,
            export_png  = export_png,
            test_mode   = test_mode,
        )
        self.worker.log.connect(self._on_log)
        self.worker.progress.connect(self._on_progress)
        self.worker.finished.connect(self._on_finished)
        self.worker.error.connect(self._on_error)

        self.single_generate_btn.setEnabled(False)
        self.batch_generate_btn.setEnabled(False)
        self.statusBar().showMessage("Generating…")
        self.worker.start()

    def _on_log(self, msg: str):
        self.log_view.append(msg)
        self.log_view.moveCursor(QTextCursor.End)

    def _on_progress(self, value: int):
        self.batch_progress.setValue(value)

    def _on_finished(self, results: List):
        self.single_generate_btn.setEnabled(True)
        self.batch_generate_btn.setEnabled(True)
        ok    = sum(1 for r in results if r.success)
        fail  = len(results) - ok
        self.log_view.append(
            f"\n{'='*60}\n"
            f"✅ Complete: {ok} succeeded, {fail} failed\n"
            f"{'='*60}"
        )
        self.statusBar().showMessage(f"Done — {ok}/{len(results)} succeeded")

    def _on_error(self, msg: str):
        self.single_generate_btn.setEnabled(True)
        self.batch_generate_btn.setEnabled(True)
        self.log_view.append(f"\n❌ ERROR: {msg}")
        QMessageBox.critical(self, "Generation Error", msg)
        self.statusBar().showMessage("Error")

    # ── Stylesheet ────────────────────────────────

    def _apply_stylesheet(self):
        self.setStyleSheet("""
            QMainWindow, QWidget {
                background-color: #1e2128;
                color: #c8cdd6;
                font-family: 'Segoe UI', Arial, sans-serif;
                font-size: 10pt;
            }
            QTabWidget::pane {
                border: 1px solid #3a3f4b;
                background: #252930;
            }
            QTabBar::tab {
                background: #2c313a;
                color: #8a909a;
                padding: 8px 18px;
                border: 1px solid #3a3f4b;
                border-bottom: none;
                margin-right: 2px;
            }
            QTabBar::tab:selected {
                background: #252930;
                color: #e8ecf2;
                border-top: 2px solid #e85d2f;
            }
            QGroupBox {
                border: 1px solid #3a3f4b;
                border-radius: 4px;
                margin-top: 1.2em;
                padding: 6px;
                color: #a0a8b4;
                font-weight: bold;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                padding: 0 6px;
            }
            QLabel { color: #c8cdd6; }
            QLineEdit, QDoubleSpinBox, QSpinBox, QComboBox {
                background: #2c313a;
                border: 1px solid #3a3f4b;
                border-radius: 3px;
                padding: 3px 6px;
                color: #e0e4ea;
            }
            QLineEdit:focus, QDoubleSpinBox:focus, QComboBox:focus {
                border-color: #e85d2f;
            }
            QComboBox::drop-down { border: none; }
            QComboBox QAbstractItemView {
                background: #2c313a;
                selection-background-color: #e85d2f;
            }
            QPushButton {
                background: #2c313a;
                border: 1px solid #4a4f5a;
                border-radius: 4px;
                padding: 5px 14px;
                color: #c8cdd6;
            }
            QPushButton:hover { background: #363c47; border-color: #e85d2f; color: #fff; }
            QPushButton:pressed { background: #1e2128; }
            QPushButton#generateBtn {
                background: #c94e27;
                border: 1px solid #e85d2f;
                color: #fff;
                font-weight: bold;
                padding: 7px 20px;
            }
            QPushButton#generateBtn:hover { background: #e85d2f; }
            QCheckBox { color: #c8cdd6; spacing: 6px; }
            QCheckBox::indicator { width: 14px; height: 14px; border: 1px solid #4a4f5a;
                                   border-radius: 2px; background: #2c313a; }
            QCheckBox::indicator:checked { background: #e85d2f; border-color: #e85d2f; }
            QProgressBar {
                border: 1px solid #3a3f4b; border-radius: 3px;
                background: #2c313a; height: 16px; text-align: center;
            }
            QProgressBar::chunk { background: #e85d2f; border-radius: 3px; }
            QTextEdit#logView {
                background: #111417;
                color: #7ec880;
                border: 1px solid #2a2f38;
                font-family: 'Consolas', monospace;
                font-size: 9pt;
            }
            QListWidget {
                background: #2c313a;
                border: 1px solid #3a3f4b;
                color: #c8cdd6;
            }
            QListWidget::item:selected { background: #e85d2f; color: white; }
            QFrame[frameShape="5"] { color: #3a3f4b; }
            #header { background: #161a20; border-bottom: 1px solid #e85d2f; }
            #headerTitle { font-size: 14pt; font-weight: bold; color: #e8ecf2; }
            #headerSubtitle { font-size: 9pt; color: #6a7080; }
            #partNumberLabel { font-size: 13pt; font-family: 'Consolas'; color: #e85d2f;
                               font-weight: bold; padding: 4px; }
            #batchCount { font-weight: bold; color: #e85d2f; }
        """)


# ──────────────────────────────────────────────
#  Entry Point
# ──────────────────────────────────────────────

def main():
    app = QApplication(sys.argv)
    app.setApplicationName("Canadian Cladding Profile Generator")
    app.setOrganizationName("CanadianCladding")

    window = ProfileGeneratorWindow()
    window.show()
    window.log_view.append("Canadian Cladding Profile Generator — Ready")
    window.log_view.append("Tip: Enable 'Test Mode' in Settings to run without Inventor.")

    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
