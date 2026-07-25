/* The Pursuit — organiser + rider-signup frontend.
   Runs the shared engine in the browser for instant feedback while persisting
   arrangements to the API, so results match the standalone app and every client. */
import { state } from "./state.js";
import { loadEvent } from "./api.js";
import { render } from "./views.js";

if (state.signup) render();
else if (state.code) loadEvent();
else render();
