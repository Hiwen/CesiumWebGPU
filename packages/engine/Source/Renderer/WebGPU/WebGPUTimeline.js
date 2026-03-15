import defined from "../../Core/defined.js";
import destroyObject from "../../Core/destroyObject.js";
import DeveloperError from "../../Core/DeveloperError.js";
import JulianDate from "../../Core/JulianDate.js";
import ClockRange from "../../Core/ClockRange.js";

// ── Inline CSS injected once per document ─────────────────────────────────────
const TIMELINE_CSS = `
.cesium-webgpu-timeline{
  position:absolute;left:0;right:0;bottom:0;
  background:linear-gradient(to top,rgba(0,0,0,.85) 0%,rgba(0,8,24,.7) 100%);
  border-top:1px solid rgba(0,160,255,.35);
  font-family:"Segoe UI",Arial,sans-serif;
  user-select:none;-webkit-user-select:none;
  z-index:100;
}
.cesium-webgpu-timeline-controls{
  display:flex;align-items:center;gap:6px;
  padding:5px 10px 3px;
}
.cesium-webgpu-timeline-btn{
  background:rgba(0,60,120,.7);border:1px solid rgba(0,160,255,.4);
  color:#7cf;border-radius:4px;cursor:pointer;
  font-size:14px;line-height:1;padding:3px 7px;
  transition:background .15s;flex-shrink:0;
}
.cesium-webgpu-timeline-btn:hover{background:rgba(0,100,200,.8)}
.cesium-webgpu-timeline-btn.active{
  background:rgba(0,140,255,.5);border-color:rgba(0,220,255,.7);color:#0ff;
}
.cesium-webgpu-timeline-date{
  flex:1;text-align:center;font-size:11px;color:#8df;
  letter-spacing:.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.cesium-webgpu-timeline-speed{
  display:flex;align-items:center;gap:4px;font-size:10px;color:#68a;flex-shrink:0;
}
.cesium-webgpu-timeline-speed input[type=range]{
  width:70px;cursor:pointer;accent-color:#08f;
}
.cesium-webgpu-timeline-speed label{min-width:42px;color:#8df;font-size:10px;text-align:right;}
.cesium-webgpu-timeline-scrubber{
  position:relative;height:18px;margin:0 10px 5px;cursor:pointer;
  background:rgba(0,30,80,.6);border:1px solid rgba(0,100,200,.4);border-radius:3px;
  overflow:hidden;
}
.cesium-webgpu-timeline-track{
  position:absolute;top:0;left:0;height:100%;width:0%;
  background:linear-gradient(to right,rgba(0,120,255,.5),rgba(0,200,255,.35));
  pointer-events:none;
}
.cesium-webgpu-timeline-needle{
  position:absolute;top:0;bottom:0;width:2px;
  background:#0af;box-shadow:0 0 4px #0af;
  pointer-events:none;transform:translateX(-50%);
}
.cesium-webgpu-timeline-tick-row{
  position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;
}
.cesium-webgpu-timeline-start,
.cesium-webgpu-timeline-end{
  position:absolute;top:1px;font-size:9px;color:#468;letter-spacing:.3px;
}
.cesium-webgpu-timeline-start{left:4px}
.cesium-webgpu-timeline-end{right:4px}
`;

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) {
    return;
  }
  const style = document.createElement("style");
  style.textContent = TIMELINE_CSS;
  document.head.appendChild(style);
  _cssInjected = true;
}

// Speed presets in simulation seconds per real second.
// Covers reverse → forward: -1yr/s, -1d/s, -1h/s, -1min/s, -1x, 1x, 1min/s, 1h/s, 1d/s, 1yr/s
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR   = 3600;
const SECONDS_PER_DAY    = 86400;
const SECONDS_PER_YEAR   = 86400 * 365;

const SPEED_STEPS = [
  -SECONDS_PER_YEAR,   // -1 year/s
  -SECONDS_PER_DAY,    // -1 day/s
  -SECONDS_PER_HOUR,   // -1 hour/s
  -SECONDS_PER_MINUTE, // -1 min/s
  -1,                  // -1x real time
  1,                   //  1x real time (index 5 = natural speed)
  SECONDS_PER_MINUTE,  //  1 min/s
  SECONDS_PER_HOUR,    //  1 hour/s
  SECONDS_PER_DAY,     //  1 day/s
  SECONDS_PER_YEAR,    //  1 year/s
];

function formatJulianDate(jd) {
  if (!defined(jd)) {
    return "--";
  }
  const d = JulianDate.toDate(jd);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}

function formatSpeed(multiplier) {
  const abs = Math.abs(multiplier);
  const sign = multiplier < 0 ? "-" : "";
  if (abs >= 86400 * 365) {
    return `${sign}${(abs / (86400 * 365)).toFixed(0)}yr/s`;
  }
  if (abs >= 86400) {
    return `${sign}${(abs / 86400).toFixed(0)}d/s`;
  }
  if (abs >= 3600) {
    return `${sign}${(abs / 3600).toFixed(0)}h/s`;
  }
  if (abs >= 60) {
    return `${sign}${(abs / 60).toFixed(0)}min/s`;
  }
  return `${sign}${abs.toFixed(0)}x`;
}

// ── WebGPUTimeline ─────────────────────────────────────────────────────────────

/**
 * A lightweight timeline overlay UI for the WebGPU renderer.
 *
 * Creates a DOM toolbar docked at the bottom of the given container element
 * and binds it to a Cesium {@link Clock} instance.  The timeline lets users:
 *   - Play / pause animation
 *   - Step backward / forward by one frame
 *   - Skip to start / end
 *   - Scrub to any point within [startTime, stopTime]
 *   - Adjust the simulation speed (multiplier)
 *
 * Usage:
 * ```js
 * import WebGPUTimeline from "./WebGPU/WebGPUTimeline.js";
 * import Clock from "../Core/Clock.js";
 * import ClockRange from "../Core/ClockRange.js";
 *
 * const clock = new Clock({
 *   startTime: JulianDate.fromIso8601("2024-01-01"),
 *   stopTime:  JulianDate.fromIso8601("2025-01-01"),
 *   clockRange: ClockRange.LOOP_STOP,
 *   multiplier: 86400, // 1 day per second
 *   shouldAnimate: true,
 * });
 *
 * const timeline = new WebGPUTimeline(canvasWrapDiv, clock);
 * // In your RAF loop:  clock.tick();  timeline.update();
 * ```
 *
 * @alias WebGPUTimeline
 * @constructor
 *
 * @param {Element} container  Parent DOM element that contains the WebGPU
 *   canvas.  The timeline bar is appended as an absolutely-positioned child.
 *   The container **must** have `position:relative` (or similar) in its CSS.
 * @param {Clock} clock  The Cesium Clock driving the simulation.
 */
function WebGPUTimeline(container, clock) {
  //>>includeStart('debug', pragmas.debug);
  if (!defined(container)) {
    throw new DeveloperError("container is required.");
  }
  if (!defined(clock)) {
    throw new DeveloperError("clock is required.");
  }
  //>>includeEnd('debug');

  injectCss();

  this._clock = clock;
  this._container = container;
  this._destroyed = false;
  this._scrubbing = false;

  // ── Build DOM ─────────────────────────────────────────────────────────────
  const root = document.createElement("div");
  root.className = "cesium-webgpu-timeline";
  this._root = root;

  // Controls row
  const ctrl = document.createElement("div");
  ctrl.className = "cesium-webgpu-timeline-controls";
  this._ctrl = ctrl;

  const mkBtn = (label, title) => {
    const b = document.createElement("button");
    b.className = "cesium-webgpu-timeline-btn";
    b.textContent = label;
    b.title = title;
    return b;
  };

  const btnFirst = mkBtn("⏮", "Jump to start");
  const btnPrev = mkBtn("⏪", "Step backward");
  const btnPlay = mkBtn("▶", "Play / Pause");
  const btnNext = mkBtn("⏩", "Step forward");
  const btnLast = mkBtn("⏭", "Jump to end");
  this._btnPlay = btnPlay;

  const dateLabel = document.createElement("span");
  dateLabel.className = "cesium-webgpu-timeline-date";
  this._dateLabel = dateLabel;

  // Speed control
  const speedWrap = document.createElement("div");
  speedWrap.className = "cesium-webgpu-timeline-speed";

  const speedLabel = document.createElement("label");
  speedLabel.textContent = "1x";
  this._speedLabel = speedLabel;

  const speedSlider = document.createElement("input");
  speedSlider.type = "range";
  speedSlider.min = "0";
  speedSlider.max = String(SPEED_STEPS.length - 1);
  speedSlider.step = "1";
  // Default index: pick the step closest to the current multiplier
  speedSlider.value = String(this._findSpeedIndex(clock.multiplier));
  this._speedSlider = speedSlider;

  speedWrap.appendChild(speedLabel);
  speedWrap.appendChild(speedSlider);

  ctrl.appendChild(btnFirst);
  ctrl.appendChild(btnPrev);
  ctrl.appendChild(btnPlay);
  ctrl.appendChild(btnNext);
  ctrl.appendChild(btnLast);
  ctrl.appendChild(dateLabel);
  ctrl.appendChild(speedWrap);

  // Scrubber row
  const scrubber = document.createElement("div");
  scrubber.className = "cesium-webgpu-timeline-scrubber";
  this._scrubber = scrubber;

  const track = document.createElement("div");
  track.className = "cesium-webgpu-timeline-track";
  this._track = track;

  const needle = document.createElement("div");
  needle.className = "cesium-webgpu-timeline-needle";
  this._needle = needle;

  const startLabel = document.createElement("span");
  startLabel.className = "cesium-webgpu-timeline-start";
  this._startLabel = startLabel;

  const endLabel = document.createElement("span");
  endLabel.className = "cesium-webgpu-timeline-end";
  this._endLabel = endLabel;

  scrubber.appendChild(track);
  scrubber.appendChild(needle);
  scrubber.appendChild(startLabel);
  scrubber.appendChild(endLabel);

  root.appendChild(ctrl);
  root.appendChild(scrubber);
  container.appendChild(root);

  // ── Event listeners ───────────────────────────────────────────────────────
  const self = this;

  btnFirst.addEventListener("click", function () {
    clock.currentTime = JulianDate.clone(clock.startTime);
  });

  btnPrev.addEventListener("click", function () {
    const step = Math.abs(clock.multiplier) || 1;
    clock.currentTime = JulianDate.addSeconds(
      clock.currentTime,
      -step,
      new JulianDate(),
    );
  });

  btnPlay.addEventListener("click", function () {
    clock.shouldAnimate = !clock.shouldAnimate;
    self._syncPlayButton();
  });

  btnNext.addEventListener("click", function () {
    const step = Math.abs(clock.multiplier) || 1;
    clock.currentTime = JulianDate.addSeconds(
      clock.currentTime,
      step,
      new JulianDate(),
    );
  });

  btnLast.addEventListener("click", function () {
    clock.currentTime = JulianDate.clone(clock.stopTime);
  });

  speedSlider.addEventListener("input", function () {
    const idx = parseInt(speedSlider.value, 10);
    clock.multiplier = SPEED_STEPS[idx];
    speedLabel.textContent = formatSpeed(clock.multiplier);
  });

  // Scrubber interaction (mouse)
  scrubber.addEventListener("mousedown", function (e) {
    self._scrubbing = true;
    self._scrubTo(e);
  });
  document.addEventListener("mousemove", function (e) {
    if (self._scrubbing) {
      self._scrubTo(e);
    }
  });
  document.addEventListener("mouseup", function () {
    self._scrubbing = false;
  });

  // Scrubber interaction (touch)
  scrubber.addEventListener(
    "touchstart",
    function (e) {
      self._scrubbing = true;
      self._scrubTo(e.touches[0]);
    },
    { passive: true },
  );
  document.addEventListener(
    "touchmove",
    function (e) {
      if (self._scrubbing) {
        self._scrubTo(e.touches[0]);
      }
    },
    { passive: true },
  );
  document.addEventListener("touchend", function () {
    self._scrubbing = false;
  });

  // Clock tick listener
  this._tickRemover = clock.onTick.addEventListener(function () {
    self.update();
  });

  // Initial render
  this._syncPlayButton();
  this.update();
}

// ── Private helpers ────────────────────────────────────────────────────────────

/**
 * Returns the SPEED_STEPS index closest to the given multiplier value.
 * @private
 */
WebGPUTimeline.prototype._findSpeedIndex = function (multiplier) {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < SPEED_STEPS.length; i++) {
    const d = Math.abs(SPEED_STEPS[i] - multiplier);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
};

/**
 * Updates the play/pause button appearance to match `clock.shouldAnimate`.
 * @private
 */
WebGPUTimeline.prototype._syncPlayButton = function () {
  if (this._clock.shouldAnimate) {
    this._btnPlay.textContent = "⏸";
    this._btnPlay.title = "Pause";
    this._btnPlay.classList.add("active");
  } else {
    this._btnPlay.textContent = "▶";
    this._btnPlay.title = "Play";
    this._btnPlay.classList.remove("active");
  }
};

/**
 * Handles a pointer/touch event on the scrubber and seeks the clock.
 * @private
 * @param {MouseEvent|Touch} e
 */
WebGPUTimeline.prototype._scrubTo = function (e) {
  const clock = this._clock;
  const rect = this._scrubber.getBoundingClientRect();
  let frac = (e.clientX - rect.left) / rect.width;
  frac = Math.max(0, Math.min(1, frac));

  const totalSeconds = JulianDate.secondsDifference(
    clock.stopTime,
    clock.startTime,
  );
  if (totalSeconds <= 0) {
    return;
  }
  clock.currentTime = JulianDate.addSeconds(
    clock.startTime,
    frac * totalSeconds,
    new JulianDate(),
  );
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Updates the timeline display to reflect the current clock state.
 *
 * This is called automatically on every `clock.onTick` event.  You can also
 * call it manually if you change `clock.currentTime` without ticking.
 */
WebGPUTimeline.prototype.update = function () {
  if (this._destroyed) {
    return;
  }

  const clock = this._clock;
  const cur = clock.currentTime;
  const start = clock.startTime;
  const stop = clock.stopTime;

  // Date label
  this._dateLabel.textContent = formatJulianDate(cur);

  // Start / stop labels on scrubber
  this._startLabel.textContent = formatJulianDate(start).slice(0, 10);
  this._endLabel.textContent = formatJulianDate(stop).slice(0, 10);

  // Needle position
  const total = JulianDate.secondsDifference(stop, start);
  let frac = 0;
  if (total > 0) {
    frac = Math.max(
      0,
      Math.min(1, JulianDate.secondsDifference(cur, start) / total),
    );
  }
  const pct = `${(frac * 100).toFixed(2)}%`;
  this._track.style.width = pct;
  this._needle.style.left = pct;

  // Speed label (keep in sync if clock.multiplier was changed externally)
  this._speedLabel.textContent = formatSpeed(clock.multiplier);

  // Play button
  this._syncPlayButton();
};

/**
 * Zooms the scrubber to show the given time range.
 *
 * This adjusts `clock.startTime` and `clock.stopTime` to match the
 * provided interval, mirroring the Cesium `Timeline.zoomTo()` API.
 *
 * @param {JulianDate} startTime
 * @param {JulianDate} stopTime
 */
WebGPUTimeline.prototype.zoomTo = function (startTime, stopTime) {
  //>>includeStart('debug', pragmas.debug);
  if (!defined(startTime)) {
    throw new DeveloperError("startTime is required.");
  }
  if (!defined(stopTime)) {
    throw new DeveloperError("stopTime is required.");
  }
  //>>includeEnd('debug');

  this._clock.startTime = JulianDate.clone(startTime);
  this._clock.stopTime = JulianDate.clone(stopTime);
  this.update();
};

/**
 * Returns `true` if this object has been destroyed.
 * @returns {boolean}
 */
WebGPUTimeline.prototype.isDestroyed = function () {
  return this._destroyed;
};

/**
 * Destroys the timeline and removes its DOM elements.
 */
WebGPUTimeline.prototype.destroy = function () {
  this._destroyed = true;
  if (defined(this._tickRemover)) {
    this._tickRemover();
    this._tickRemover = undefined;
  }
  if (defined(this._root) && defined(this._root.parentNode)) {
    this._root.parentNode.removeChild(this._root);
  }
  return destroyObject(this);
};

export default WebGPUTimeline;
