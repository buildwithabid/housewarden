import type { Metadata } from "next";
import { runRoutine, setDeviceState } from "@/app/actions/devices";
import type { Device, Routine, RoutineStep } from "@/lib/contracts";
import { loadConsole, withHousehold } from "@/lib/console/data";
import { fmtAgo, toolTitle } from "@/lib/console/format";
import { readQuery, type SearchParams } from "@/lib/console/page";
import { listDevices, listRoutines } from "@/lib/domain";
import { Chip } from "@/components/Chip";
import { ConfirmSlot } from "@/components/ConfirmSlot";
import { EmptyState } from "@/components/EmptyState";
import { Flash } from "@/components/Flash";
import { NoHousehold } from "@/components/NoHousehold";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Devices" };

function Hidden({ device }: { device: Device }) {
  return (
    <>
      <input type="hidden" name="device" value={device.id} />
      <input type="hidden" name="kind" value={device.kind} />
    </>
  );
}

function LockControls({ device }: { device: Device }) {
  const locked = device.state.locked === true;
  return (
    <form action={setDeviceState} className="flex items-center justify-between gap-3">
      <Hidden device={device} />
      <input type="hidden" name="locked" value={locked ? "false" : "true"} />
      <Chip tone={locked ? "accent" : "warn"}>{locked ? "Locked" : "Unlocked"}</Chip>
      <SubmitButton size="sm" variant={locked ? "danger-secondary" : "primary"} pendingLabel="Proposing…">
        {locked ? "Unlock" : "Lock"}
      </SubmitButton>
    </form>
  );
}

function ThermostatControls({ device }: { device: Device }) {
  const mode = typeof device.state.mode === "string" ? device.state.mode : "off";
  const target = typeof device.state.target_c === "number" ? device.state.target_c : 21;
  const id = `thermo-${device.id}`;
  return (
    <form action={setDeviceState} className="flex flex-col gap-3">
      <Hidden device={device} />
      <div className="flex items-center gap-2">
        <Chip tone={mode === "off" ? "neutral" : "info"}>{mode}</Chip>
        <span className="tabular font-mono text-ink">{target}°C</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-2" htmlFor={`${id}-mode`}>
          Mode
          <select id={`${id}-mode`} name="mode" className="input min-h-11 py-1 text-sm" defaultValue={mode}>
            <option value="cool">Cool</option>
            <option value="heat">Heat</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2" htmlFor={`${id}-target`}>
          Target °C
          <input id={`${id}-target`} name="target_c" type="number" min={5} max={35} step={0.5} className="input tabular min-h-11 py-1 text-sm" defaultValue={target} />
        </label>
      </div>
      <SubmitButton size="sm" variant="primary" pendingLabel="Setting…" className="w-full">
        Set thermostat
      </SubmitButton>
    </form>
  );
}

function LightControls({ device }: { device: Device }) {
  const on = device.state.on === true;
  const brightness = typeof device.state.brightness === "number" ? device.state.brightness : 100;
  const id = `light-${device.id}`;
  return (
    <form action={setDeviceState} className="flex flex-col gap-3">
      <Hidden device={device} />
      <div className="flex items-center gap-2">
        <Chip tone={on ? "accent" : "neutral"}>{on ? "On" : "Off"}</Chip>
        <span className="tabular font-mono text-sm text-ink-2">{brightness}%</span>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink" htmlFor={`${id}-on`}>
        <input id={`${id}-on`} name="on" type="checkbox" className="check" defaultChecked={on} /> On
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-2" htmlFor={`${id}-brightness`}>
        Brightness
        <input id={`${id}-brightness`} name="brightness" type="range" min={0} max={100} className="range" defaultValue={brightness} />
      </label>
      <SubmitButton size="sm" variant="primary" pendingLabel="Setting…" className="w-full">
        Set light
      </SubmitButton>
    </form>
  );
}

function PlugControls({ device }: { device: Device }) {
  const on = device.state.on === true;
  return (
    <form action={setDeviceState} className="flex items-center justify-between gap-3">
      <Hidden device={device} />
      <input type="hidden" name="on" value={on ? "false" : "true"} />
      <Chip tone={on ? "accent" : "neutral"}>{on ? "On" : "Off"}</Chip>
      <SubmitButton size="sm" variant={on ? "secondary" : "primary"} pendingLabel="Setting…">
        {on ? "Switch off" : "Switch on"}
      </SubmitButton>
    </form>
  );
}

function Controls({ device }: { device: Device }) {
  switch (device.kind) {
    case "lock":
      return <LockControls device={device} />;
    case "thermostat":
      return <ThermostatControls device={device} />;
    case "light":
      return <LightControls device={device} />;
    case "plug":
      return <PlugControls device={device} />;
  }
}

function describeStep(step: RoutineStep): string {
  const input = step.input;
  switch (step.tool) {
    case "set_device_state": {
      const state = input.state && typeof input.state === "object" ? (input.state as Record<string, unknown>) : {};
      const parts = Object.entries(state).map(([k, v]) => `${k} ${typeof v === "boolean" ? (v ? "yes" : "no") : String(v)}`);
      return `${String(input.device ?? "device")}: ${parts.join(", ") || "no change"}`;
    }
    case "add_reminder":
      return `“${String(input.text ?? "")}” at ${String(input.at ?? "")}`;
    case "check_off_shopping_item":
      return String(input.item ?? "");
  }
}

function RoutineCard({ routine }: { routine: Routine }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-ink">{routine.name}</p>
          <p className="text-sm text-ink-2">{routine.steps.length} steps, run together as one guarded action.</p>
        </div>
        <form action={runRoutine}>
          <input type="hidden" name="routine" value={routine.id} />
          <SubmitButton size="sm" variant="primary" pendingLabel="Proposing…">
            Run
          </SubmitButton>
        </form>
      </div>
      <ol className="divide-y divide-border rounded-md border border-border">
        {routine.steps.map((step, i) => (
          <li key={i} className="flex flex-col gap-0.5 px-3 py-2 text-sm sm:flex-row sm:items-baseline sm:gap-3">
            <span className="shrink-0 font-mono text-xs text-ink-3">{i + 1}</span>
            <span className="shrink-0 font-medium text-ink">{toolTitle(step.tool)}</span>
            <span className="text-ink-2">{describeStep(step)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default async function DevicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [ctx, q] = await Promise.all([loadConsole("/devices"), readQuery(searchParams)]);
  const h = withHousehold(ctx);
  if (!h) {
    return (
      <>
        <PageHeader title="Devices" />
        <NoHousehold />
      </>
    );
  }

  const [devices, routines] = await Promise.all([listDevices(h.db, h.household.id), listRoutines(h.db, h.household.id)]);
  const tz = h.household.timezone;

  return (
    <>
      <PageHeader title="Devices" description="Simulated smart-home devices. Locks ask for approval before they change; a child unlocking the door needs a person here." />
      <Flash message={q.flash} tone={q.tone} />
      <ConfirmSlot id={q.confirm} ctx={h} returnTo="/devices" />

      <Section id="devices" title="Devices" count={devices.length}>
        {devices.length === 0 ? (
          <EmptyState title="No devices" body="The demo household comes with a front door lock and a living room thermostat." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
            {devices.map((d) => (
              <div key={d.id} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 md:p-6">
                <div>
                  <p className="text-xs font-medium uppercase text-ink-2">{d.kind}</p>
                  <p className="mt-1 text-lg font-medium text-ink">{d.name}</p>
                  <p className="text-xs text-ink-3">changed {fmtAgo(d.updated_at, h.now, tz, h.today)}</p>
                </div>
                <Controls device={d} />
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section id="routines" title="Routines" count={routines.length}>
        {routines.length === 0 ? (
          <EmptyState title="No routines" body="A routine runs several device and reminder steps together after one approval." />
        ) : (
          <div className="grid gap-3 md:gap-4 xl:grid-cols-2">
            {routines.map((r) => (
              <RoutineCard key={r.id} routine={r} />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
