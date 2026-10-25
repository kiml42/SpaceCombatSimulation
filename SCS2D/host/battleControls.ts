/**
 * The doctrine panel, the order bar and the card of an asteroid picked out over a battle, as every page that gives
 * orders shows them: their markup and their look, put in place once so the
 * pages cannot drift apart. `orderBar` and `doctrinePanel` then work them.
 */
export function battleControls(stage: HTMLElement): void {
    if (document.getElementById("orderBar") !== null) return;
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.append(style);
    stage.insertAdjacentHTML("beforeend", MARKUP);
}

const STYLE = `
  /* Over the battle rather than beside it, so picking a ship out never resizes the view under the pointer. */
  #orderBar {
    position: absolute; left: 0; right: 0; bottom: 0;
    display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;
    padding: 0.4rem 0.9rem; background: #0b0f16d9; border-top: 1px solid #1c2533;
  }
  #orderBar button.armed { background: #3a4f6e; border-color: #7fa8e0; }
  #orderBar select { max-width: 12rem; }
  #orderBar input[type='number'] { width: 5rem; }
  #armedHint, #orderBar .warn { color: #e9c05f; }
  #queue { display: flex; flex-wrap: wrap; gap: 0.3rem 0.9rem; margin: 0; padding: 0; list-style-position: inside; }
  #queue button { padding: 0 0.3rem; }
  #asteroidCard {
    position: absolute; left: 0; top: 0; padding: 0.4rem 0.7rem;
    background: #0b0f16d9; border: 1px solid #1c2533; border-width: 0 1px 1px 0;
  }
  #asteroidCard b { color: #c8d3e0; font-weight: normal; }
  #doctrinePanel {
    position: absolute; right: 0; top: 0; bottom: 3rem; width: 19rem; max-width: 60vw; overflow-y: auto;
    padding: 0.5rem 0.7rem; background: #0b0f16e6; border-left: 1px solid #1c2533;
  }
  #doctrinePanel .tabs { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.5rem; }
  #doctrinePanel button.armed { background: #3a4f6e; border-color: #7fa8e0; }
  #doctrinePanel .rows { display: grid; gap: 0.25rem; margin-bottom: 0.5rem; }
  #doctrinePanel label { justify-content: space-between; }
  #doctrinePanel label span { flex: 1; }
  #doctrinePanel label.told span { color: #e9c05f; }
  #doctrinePanel input { width: 5.5rem; }
  #doctrinePanel p { color: #7f93aa; margin: 0.4rem 0 0; }
  #doctrinePanel h3 { font-size: 0.85rem; margin: 0.6rem 0 0.1rem; color: #c8d3e0; }
  #doctrinePanel h4 { font-size: 0.8rem; margin: 0.3rem 0 0; color: #8fa2b8; font-weight: normal; }
`;

const MARKUP = `
<div id="doctrinePanel" hidden></div>
<div id="asteroidCard" hidden></div>
<div id="orderBar" hidden>
  <button data-verb="attack" title="Attack the next ship clicked (K); Ctrl to add to its orders">Attack</button>
  <select id="cancelOn" title="What finishes an attack given with the button">
    <option value="5" selected>until disabled</option>
    <option value="1">until destroyed</option>
    <option value="2">until disarmed</option>
    <option value="3">until its engines are out</option>
    <option value="4">until disarmed or engines out</option>
  </select>
  <button data-verb="defend" title="Defend the next friend clicked (D)">Defend</button>
  <button data-verb="ram" title="Ram the next ship clicked (R)">Ram</button>
  <label title="How far off every attack or defence given, by button, key or right-click, holds its target, metres from its skin; empty for doctrine's, as it changes">hold
    <input id="holdDistance" type="number" min="0" step="10" placeholder="doctrine"> m</label>
  <label title="How fast every attack, defence or ram given closes, metres a second; empty for doctrine's, as it changes">at
    <input id="holdSpeed" type="number" min="0" step="5" placeholder="doctrine"> m/s</label>
  <button data-verb="dock" title="Dock with the next friend clicked, and take on all it can give (H)">Dock</button>
  <button data-verb="scavenge" title="Fill its claw from the next ship or asteroid clicked, friend or foe (G); right-click an asteroid for the same">Scavenge</button>
  <button data-verb="deliver" title="Give the next friend clicked all it can spare, through its port (U)">Deliver</button>
  <button data-verb="flee" title="Run from the next enemy clicked, or hide behind the next friend or wreck; Enter runs from every enemy. Until told otherwise (W)">Flee</button>
  <button id="stop" title="Clear their orders, back to doctrine (S)">Stop</button>
  <button id="doctrine" title="How they fight, over what their blueprints say (P)">Doctrine</button>
  <select id="remodelTo" title="What they are built to; choose another and Remodel to refit them, their robots building it as they fight on"></select>
  <button id="remodel" title="Refit them to the design chosen">Remodel</button>
  <span id="remodelWarning" class="warn" hidden>⚠ It has no robot bay: the old bays stay until the end, so the remodel can never be finished.</span>
  <span id="armedHint"></span>
  <button id="nearest" hidden title="Without a target: wherever its doctrine would choose (Enter); Ctrl to queue">Nearest (Enter)</button>
  <ol id="queue"></ol>
</div>
`;
