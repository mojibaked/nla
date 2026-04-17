import assert from "node:assert/strict";
import test from "node:test";
import { defineAdapter } from "@nla/sdk-core";
import { createTestHost } from "@nla/test";

test("sdk-core returns session controls from session.controls.get", async () => {
  const host = createTestHost(defineAdapter({
    id: "controls-get",
    name: "Controls Get",
    async sessionStart(ctx) {
      ctx.started();
    },
    async sessionControls() {
      return [
        {
          id: "mode",
          kind: "select",
          label: "Mode",
          value: "safe",
          options: [
            {
              id: "safe",
              label: "Safe"
            },
            {
              id: "fast",
              label: "Fast"
            }
          ]
        }
      ];
    }
  }));

  await host.startSession("sess_controls");
  const controls = await host.getSessionControls("sess_controls");
  assert.ok(controls);
  assert.equal(controls.data.controls.length, 1);
  assert.equal(controls.data.controls[0].id, "mode");
});

test("sdk-core returns unsupported control state when sessionControl is absent", async () => {
  const host = createTestHost(defineAdapter({
    id: "controls-unsupported",
    name: "Controls Unsupported",
    async sessionStart(ctx) {
      ctx.started();
    }
  }));

  await host.startSession("sess_control_unsupported");
  const messages = await host.sendSessionControl("sess_control_unsupported", "mode", "safe");
  const state = messages.find((message) => message.type === "session.control.state");
  assert.ok(state);
  assert.equal(state.data.controlId, "mode");
  assert.equal(state.data.status, "unsupported");
});

test("sdk-core returns an empty controls list when sessionControls does not respond", async () => {
  const host = createTestHost(defineAdapter({
    id: "controls-empty",
    name: "Controls Empty",
    async sessionStart(ctx) {
      ctx.started();
    },
    async sessionControls() {}
  }));

  await host.startSession("sess_controls_empty");
  const controls = await host.getSessionControls("sess_controls_empty");
  assert.ok(controls);
  assert.deepEqual(controls.data.controls, []);
});
