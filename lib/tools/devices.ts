/**
 * list_devices, set_device_state, run_routine.
 */
import { z } from "zod";
import { DeviceSchema, RoutineSchema, defineMutatingTool, defineReadTool, type Device, type Routine } from "@/lib/contracts";
import {
  RunRoutineInputSchema,
  RunRoutineResultSchema,
  SetDeviceStateInputSchema,
  SetDeviceStateResultSchema,
  joinSpoken,
  listDevices,
  listRoutines,
  planRunRoutine,
  planSetDeviceState,
  upperFirst,
} from "@/lib/domain";
import { numberWord } from "@/lib/time";
import { READ_ANNOTATIONS, catalogueTitle, defaultRiskOf, mutatingAnnotations } from "./context";
import { sentence } from "./spoken";

export function describeDevice(device: Device): string {
  const name = device.name.toLowerCase();
  const s = device.state;
  switch (device.kind) {
    case "lock":
      return `the ${name} is ${s.locked ? "locked" : "unlocked"}`;
    case "thermostat":
      if (s.mode === "off") return `the ${name} thermostat is off`;
      return `the ${name} is ${s.mode === "cool" ? "cooling" : "heating"} to ${String(s.target_c)} degrees`;
    case "light":
      return s.on ? `the ${name} light is on${typeof s.brightness === "number" ? ` at ${s.brightness}%` : ""}` : `the ${name} light is off`;
    case "plug":
      return `the ${name} plug is ${s.on ? "on" : "off"}`;
  }
}

export function spokenDevices(devices: readonly Device[], routines: readonly Routine[]): string {
  const first = devices.length === 0 ? "No devices are set up." : sentence(upperFirst(joinSpoken(devices.map(describeDevice))));
  const names = routines.map((r) => r.name);
  const second =
    routines.length === 0
      ? "No routines are set up."
      : routines.length === 1
        ? `One routine is available: ${names[0]}.`
        : `${upperFirst(numberWord(routines.length))} routines are available: ${joinSpoken(names)}.`;
  return `${first} ${second}`;
}

export const listDevicesTool = defineReadTool({
  kind: "read",
  name: "list_devices",
  title: catalogueTitle("list_devices"),
  description: "Lists the smart-home devices with their current state, and the routines that can be run. Needs nothing.",
  inputSchema: z.object({}),
  outputSchema: z.object({ devices: z.array(DeviceSchema), routines: z.array(RoutineSchema) }),
  annotations: READ_ANNOTATIONS,
  async run(_input, ctx) {
    const [devices, routines] = await Promise.all([listDevices(ctx.db, ctx.household.id), listRoutines(ctx.db, ctx.household.id)]);
    return { output: { devices, routines }, spoken: spokenDevices(devices, routines) };
  },
});

export const setDeviceStateTool = defineMutatingTool({
  kind: "mutating",
  name: "set_device_state",
  title: catalogueTitle("set_device_state"),
  description: "Changes a device's state, such as locking a door or setting a thermostat. Needs the device and the fields to change.",
  inputSchema: SetDeviceStateInputSchema,
  resultSchema: SetDeviceStateResultSchema,
  defaultRisk: defaultRiskOf("set_device_state"),
  annotations: mutatingAnnotations(),
  plan: planSetDeviceState,
});

export const runRoutineTool = defineMutatingTool({
  kind: "mutating",
  name: "run_routine",
  title: catalogueTitle("run_routine"),
  description: "Runs a saved routine, applying each of its steps together. Needs the routine name.",
  inputSchema: RunRoutineInputSchema,
  resultSchema: RunRoutineResultSchema,
  defaultRisk: defaultRiskOf("run_routine"),
  annotations: mutatingAnnotations(),
  plan: planRunRoutine,
});
