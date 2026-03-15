import * as Cesium from "cesium";
import Sandcastle from "Sandcastle";

// ─── Clock setup (mirrors the native Cesium "Clock" demo) ────────────────────
// The clock loops over the year 2024 at 1 day per second, matching what
// the WebGPU globe shader uses for cloud-layer animation.
const clock = new Cesium.Clock({
  startTime: Cesium.JulianDate.fromIso8601("2024-01-01T00:00:00Z"),
  currentTime: Cesium.JulianDate.fromIso8601("2024-01-01T00:00:00Z"),
  stopTime: Cesium.JulianDate.fromIso8601("2025-01-01T00:00:00Z"),
  clockRange: Cesium.ClockRange.LOOP_STOP, // loop when the end time is reached
  clockStep: Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER,
  multiplier: 86400, // advance 1 day of sim-time per real second
  shouldAnimate: true,
});

// ─── Viewer ───────────────────────────────────────────────────────────────────
// Pass the clock via ClockViewModel so the native Cesium Timeline widget
// (visible at the bottom of the viewer) is bound to our clock.  When WebGPU
// is available (Chrome 113+) the scene will automatically activate the WebGPU
// renderer while the native timeline continues to drive simulation time.
const viewer = new Cesium.Viewer("cesiumContainer", {
  clockViewModel: new Cesium.ClockViewModel(clock),
  shouldAnimate: true,
  // Enable day/night globe lighting so the time-of-day effect is visible.
  // (The WebGPU globe renderer provides its own sun-direction calculation.)
  terrainProvider: undefined,
});

viewer.scene.globe.enableLighting = true;

// Zoom the native timeline bar to the full 2024 range.
viewer.timeline.zoomTo(clock.startTime, clock.stopTime);

// ─── WebGPU status badge ──────────────────────────────────────────────────────
// Display a badge in the toolbar once the WebGPU renderer is ready so the
// user can confirm which rendering backend is active.
function checkWebGPUReady() {
  if (viewer.scene.webGPUReady) {
    Sandcastle.addToolbarLabel("🟢 WebGPU Active");
  } else if (typeof Cesium.isWebGPUSupported === "function" && Cesium.isWebGPUSupported()) {
    // WebGPU is supported but may still be initializing – retry shortly.
    setTimeout(checkWebGPUReady, 500);
  } else {
    Sandcastle.addToolbarLabel("🔵 WebGL (WebGPU not supported in this browser)");
  }
}
checkWebGPUReady();

// ─── Toolbar controls ─────────────────────────────────────────────────────────
// These mirror the native Cesium "Clock" demo controls so you can compare
// the behavior side-by-side.

Sandcastle.addToolbarButton("⏮ Reset to Start", function () {
  viewer.clock.currentTime = Cesium.JulianDate.clone(viewer.clock.startTime);
  viewer.timeline.updateFromClock();
});

Sandcastle.addToolbarButton("⏪ Slow Down (½×)", function () {
  viewer.clockViewModel.multiplier /= 2;
});

Sandcastle.addToolbarButton("⏩ Speed Up (2×)", function () {
  viewer.clockViewModel.multiplier *= 2;
});

Sandcastle.addToolbarButton("⏭ Jump to End", function () {
  viewer.clock.currentTime = Cesium.JulianDate.clone(viewer.clock.stopTime);
  viewer.timeline.updateFromClock();
});
