using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace GlowBoard
{
    /// <summary>
    /// Cửa sổ Overview rời: cửa sổ Windows bình thường (phóng to / thu nhỏ / kéo giãn), nằm trên taskbar.
    /// Không tự kết nối Firebase: board chính gửi dữ liệu sang qua host (tin nhắn "ovData").
    /// </summary>
    internal sealed class OverviewForm : Form
    {
        private readonly WebView2 _web;
        private readonly Settings _settings;
        private readonly CoreWebView2Environment _env;
        private readonly Func<string> _lastData;
        private readonly Action<string> _openLink;
        private readonly Action<string> _toBoard;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();
        private bool _ready;

        public OverviewForm(CoreWebView2Environment env, Settings settings, Icon icon, Func<string> lastData, Action<string> openLink, Action<string> toBoard)
        {
            _env = env; _settings = settings; _lastData = lastData; _openLink = openLink; _toBoard = toBoard;
            Text = "Mondiro GlowBoard – Overview";
            Icon = icon;
            StartPosition = FormStartPosition.Manual;
            BackColor = Color.FromArgb(0x2B, 0x2D, 0x31);
            MinimumSize = new Size(Scale(360), Scale(300));
            Bounds = InitialBounds();
            if (_settings.GetBool("OvMax")) WindowState = FormWindowState.Maximized;

            _web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(0x2B, 0x2D, 0x31) };
            Controls.Add(_web);

            ResizeEnd += (s, e) => SaveBounds();
            FormClosing += (s, e) => SaveBounds();
        }

        private int Scale(int px) => (int)Math.Round(px * DeviceDpi / 96.0);

        private Rectangle InitialBounds()
        {
            var r = new Rectangle(_settings.GetInt("OvX", int.MinValue), _settings.GetInt("OvY", int.MinValue),
                                  _settings.GetInt("OvW", 0), _settings.GetInt("OvH", 0));
            bool visible = r.Width > 0 && r.Height > 0 &&
                           Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(new Rectangle(r.X + 40, r.Y + 10, Math.Max(1, r.Width - 80), Scale(30))));
            if (visible) return r;
            var wa = Screen.PrimaryScreen.WorkingArea;
            int w = Math.Min(Scale(640), wa.Width - Scale(40)), h = Math.Min(Scale(720), wa.Height - Scale(40));
            return new Rectangle(wa.Left + (wa.Width - w) / 2, wa.Top + (wa.Height - h) / 2, w, h);
        }

        private void SaveBounds()
        {
            _settings.Set("OvMax", WindowState == FormWindowState.Maximized ? 1 : 0);
            if (WindowState == FormWindowState.Normal)
            {
                _settings.Set("OvX", Left); _settings.Set("OvY", Top); _settings.Set("OvW", Width); _settings.Set("OvH", Height);
            }
            _settings.Save();
        }

        // Thanh tiêu đề tối cùng màu giao diện (Windows 10 20H1+ / Windows 11)
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            try
            {
                int on = 1;
                NativeMethods.DwmSetWindowAttribute(Handle, NativeMethods.DWMWA_USE_IMMERSIVE_DARK_MODE, ref on, sizeof(int));
                int caption = 0x0026211F;   // #1F2126 (COLORREF = 0x00BBGGRR)
                NativeMethods.DwmSetWindowAttribute(Handle, NativeMethods.DWMWA_CAPTION_COLOR, ref caption, sizeof(int));
            }
            catch { }
        }

        protected override async void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            try { await _web.EnsureCoreWebView2Async(_env); }
            catch { Close(); return; }
            var core = _web.CoreWebView2;
            MainForm.SetupCore(core, _env, _openLink);
            core.WebMessageReceived += OnWebMessage;
            core.Navigate(MainForm.AppOrigin + "index.html?ov=1");
        }

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            Dictionary<string, object> msg;
            try { msg = _json.Deserialize<Dictionary<string, object>>(e.TryGetWebMessageAsString()); }
            catch { return; }
            string Str(string k) => msg.TryGetValue(k, out var v) ? v as string : null;
            switch (Str("type"))
            {
                case "ovReady":
                    _ready = true;
                    var d = _lastData();
                    if (d != null) PostRaw(d);
                    break;
                case "openLink": _openLink(Str("url")); break;
                case "ovMeta":
                case "ovRefresh": _toBoard(e.TryGetWebMessageAsString()); break;   // board ghi lên Firebase
            }
        }

        /// <summary>Chuyển nguyên tin nhắn "ovData" từ board chính sang trang Overview.</summary>
        public void PostRaw(string json)
        {
            if (!_ready || _web.CoreWebView2 == null) return;
            _web.CoreWebView2.PostWebMessageAsString(json);
        }

        public void BringUp()
        {
            if (WindowState == FormWindowState.Minimized) WindowState = _settings.GetBool("OvMax") ? FormWindowState.Maximized : FormWindowState.Normal;
            Show();
            Activate();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) _web?.Dispose();
            base.Dispose(disposing);
        }
    }
}
