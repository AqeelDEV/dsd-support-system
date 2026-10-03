import type { CatalogArticle } from "../kb-catalog.js";

/** Setting devices up and fixing them, product by product. */
export const TROUBLESHOOTING_ARTICLES: readonly CatalogArticle[] = [
  {
    category: "troubleshooting",
    slug: "nimbus-router-dropping-connection",
    title: "Nimbus Mesh Router keeps dropping the connection",
    summary:
      "Most drop-outs come from a node placed too far away or old firmware. Check both before a factory reset.",
    tags: ["nimbus", "wifi", "router"],
    published: true,
    body: `## Check where the nodes are

Each node should be no more than two rooms from the next, away from microwaves and large metal objects. In the app, a node with a **red** link light is too far away.

## Update the firmware

Open the Nimbus app, choose **Settings**, then **Firmware**. Updates take about 10 minutes and restart the network once.

## Restart in the right order

1. Unplug every node and your broadband modem.
2. Plug the modem in and wait until it is online.
3. Plug in the main node, wait for a **white** light, then the others.

## Still dropping

A factory reset is the last step: hold the reset button on the main node for 10 seconds. You will need to set the network up again in the app. Contact support if drop-outs continue afterwards.`,
  },
  {
    category: "troubleshooting",
    slug: "harbor-camera-offline",
    title: "Harbor Indoor Camera shows as offline",
    summary:
      "An offline camera has usually lost its Wi-Fi. Check the light, the network name and the power supply.",
    tags: ["harbor", "camera", "wifi"],
    published: true,
    body: `## Read the light

- **Blinking blue:** the camera is looking for Wi-Fi.
- **Solid red:** it is connected to Wi-Fi but can't reach our service.
- **No light:** check the power supply and cable.

## Wi-Fi changes

If you changed your Wi-Fi name or password, the camera can't join until you set it up again: in the app choose the camera, then **Settings**, then **Wi-Fi**.

## It goes offline at night

Some routers turn Wi-Fi off on a schedule. Check your router's settings, or use a Nimbus node near the camera.

Recordings made while the camera was offline are kept on its memory card and uploaded when it reconnects.`,
  },
  {
    category: "troubleshooting",
    slug: "tempo-thermostat-firmware",
    title: "Updating the Tempo Smart Thermostat",
    summary: "Draft: firmware update steps for the next Tempo release.",
    tags: ["tempo", "thermostat", "firmware"],
    published: false,
    body: `## Before you start

Make sure the thermostat is online and its battery is above 30%.

## Steps

1. Open the Tempo app and choose the thermostat.
2. Choose **Settings**, then **Firmware**, then **Update**.

The heating keeps its schedule during the update.`,
  },
  {
    category: "troubleshooting",
    slug: "device-wont-connect-to-wifi",
    title: "A device won't connect to Wi-Fi during setup",
    summary:
      "Our devices set up on 2.4 GHz Wi-Fi only, and don't support WPA3-only networks yet.",
    tags: ["wifi", "setup", "router"],
    published: true,
    body: `## Use the 2.4 GHz band

The Tempo Smart Thermostat, Harbor Indoor Camera, Lumen Desk Lamp and Quill Smart Plug connect over **2.4 GHz** Wi-Fi only. Many routers combine 2.4 GHz and 5 GHz under one network name, and a phone on the 5 GHz band can't hand the device over during setup.

- Stand near the router while you set the device up.
- If setup gets stuck on **connecting**, turn off the 5 GHz band in your router's settings for a few minutes, set the device up, then turn it back on. The device stays on 2.4 GHz.

## Check the security setting

Our devices support WPA2 and **WPA2/WPA3 mixed** mode, but not **WPA3-only** networks yet. If your router is set to WPA3 only, switch it to WPA2/WPA3 mixed mode; your other devices keep working. A firmware update will add WPA3-only support.

## Still stuck

Restart the router, then try again. If setup still fails, contact support with the device name and your router's make and model.`,
  },
  {
    category: "troubleshooting",
    slug: "offline-after-firmware-update",
    title: "A device shows offline after a firmware update",
    summary:
      "Restart the device without resetting it. If it's on firmware 3.2.1, version 3.2.2 fixes a known offline problem.",
    tags: ["firmware", "offline", "update"],
    published: true,
    body: `## Restart without resetting

Hold the device's button for **5 seconds**, then let go. The device restarts and keeps its settings. Holding for 10 seconds or more resets it to factory settings, so let go at 5.

After the restart the light blinks, then stays solid when the device is connected.

## Known issue in firmware 3.2.1

On firmware **3.2.1**, a Quill Smart Plug, Lumen Desk Lamp or Harbor Indoor Camera can show as offline in the app even though its light says it's connected. Version **3.2.2** fixes this. Updates install automatically overnight; to update straight away, open the device in the app and choose **Settings**, then **Firmware**. Once updated, the device shows online within a few minutes.

You can see the firmware version under **Settings**, then **About** for each device.

## Still offline

Check that your Wi-Fi works on another device, then see [A device won't connect to Wi-Fi during setup](/help/device-wont-connect-to-wifi). Contact support if it's still offline.`,
  },
  {
    category: "troubleshooting",
    slug: "pace-battery-drains-quickly",
    title: "Pace Fitness Band battery drains quickly",
    summary:
      "A charge should last up to 7 days. Firmware 5.0.5 fixes a battery drain in 5.0.4; continuous heart-rate monitoring also uses more power.",
    tags: ["pace", "battery", "firmware"],
    published: true,
    body: `## How long a charge lasts

A fully charged Pace Fitness Band lasts **up to 7 days** with everyday use. Continuous heart-rate monitoring, GPS workouts and an always-on display all shorten that.

## Check the firmware

In the Pace app choose **Device**, then **About**. Firmware **5.0.4** has a known problem that can drain the battery in less than a day. **5.0.5** fixes it: choose **Device**, then **Firmware**, then **Update**, and keep the band near your phone until it finishes.

## Check the settings

- Turn off continuous heart-rate monitoring under **Device**, then **Health**, if you don't need it.
- Shorten the display timeout and turn off wrist-raise to wake.

## Still draining

If the battery still doesn't last a day after updating, contact support. The band is covered by the 2-year warranty, and we replace it if the battery is faulty.`,
  },
  {
    category: "troubleshooting",
    slug: "nimbus-node-keeps-disconnecting",
    title: "One Nimbus node keeps disconnecting",
    summary:
      "A node that drops off on its own is usually out of range. Move it closer, add a node in between, or connect it with a cable.",
    tags: ["nimbus", "mesh", "wifi"],
    published: true,
    body: `## Test the signal

Move the node halfway towards the main unit for a day. If it stops dropping, signal strength was the problem, not the node. In the app, a healthy node shows a **white** link light; **red** means it's too far away.

## Keep it stable

- **Leave it closer.** Nodes work best no more than two rooms apart.
- **Add a node in between** if you need coverage further away.
- **Use a cable.** Connecting the node to the main unit with a network cable (a wired backhaul) gives the most stable connection, through any walls. The app detects the cable by itself.

## Still dropping close to the main unit

Update the firmware under **Settings**, then **Firmware**, and see [Nimbus Mesh Router keeps dropping the connection](/help/nimbus-router-dropping-connection). If the node still drops when it's in the same room as the main unit, contact support: it may be faulty and is covered by the 2-year warranty.`,
  },
  {
    category: "troubleshooting",
    slug: "tempo-schedule-resets",
    title: "Tempo Smart Thermostat schedule goes back to the default",
    summary:
      "A schedule that resets has usually lost power or wasn't saved to the thermostat. Check the battery and save the schedule again.",
    tags: ["tempo", "thermostat", "schedule"],
    published: true,
    body: `## Save the schedule to the thermostat

Changes you make in the Tempo app are saved to the thermostat when you choose **Save**. If you leave the screen without saving, the thermostat keeps its old schedule. After saving, the thermostat shows a tick.

## Check the power

The Tempo keeps its schedule through short power cuts using its backup battery. If the battery is below **20%**, a power cut can reset the schedule to the factory default. The app shows the battery level under **Settings**, then **Battery**; replace it with two AA batteries.

## Update the firmware

Some early units lose their schedule after a firmware update. Make sure the thermostat is on the latest firmware under **Settings**, then **Firmware**, then save your schedule again.

## Still resetting

Contact support with the thermostat's firmware version and roughly when the schedule resets, for example every morning or after a power cut.`,
  },
  {
    category: "troubleshooting",
    slug: "lumen-lamp-flickers",
    title: "Lumen Desk Lamp flickers or won't dim",
    summary:
      "Flicker is usually the power adapter or a low brightness setting on old firmware. Use the supplied adapter and update the lamp.",
    tags: ["lumen", "lamp", "flicker"],
    published: true,
    body: `## Use the supplied adapter

The Lumen Desk Lamp needs its own 12 volt adapter. Phone chargers and USB hubs don't supply enough power, which makes the lamp flicker, especially at full brightness.

## Low brightness flicker

Lamps on firmware older than **2.4** can flicker below 10% brightness. Update the lamp in the app under **Settings**, then **Firmware**.

## It won't dim

- Dimming from the app or the touch strip needs the lamp to be online; check its light.
- If you've linked the lamp to a schedule or a scene, it may be setting the brightness back. Check **Schedules** in the app.

## Still flickering

Restart the lamp by holding its power button for 5 seconds. If it still flickers with the supplied adapter and the latest firmware, contact support; the lamp is covered by the 2-year warranty.`,
  },
  {
    category: "troubleshooting",
    slug: "quill-plug-wont-pair",
    title: "Quill Smart Plug won't pair with the app",
    summary:
      "Put the plug in pairing mode by holding its button until the light flashes blue, and pair it on 2.4 GHz Wi-Fi.",
    tags: ["quill", "plug", "setup"],
    published: true,
    body: `## Pairing mode

1. Plug the Quill Smart Plug into a socket near your router.
2. Hold its button for **10 seconds**, until the light **flashes blue**. That's pairing mode.
3. In the app choose **Add device**, then **Quill Smart Plug**, and follow the steps.

If the light flashes red instead, the plug is already paired to another account. Ask the previous owner to remove it in their app, or hold the button for 10 seconds again to reset it.

## Wi-Fi

Like our other devices, the plug pairs on **2.4 GHz** Wi-Fi only, and not on WPA3-only networks. See [A device won't connect to Wi-Fi during setup](/help/device-wont-connect-to-wifi).

## Still not pairing

Keep your phone's Bluetooth on during pairing: the app uses it to hand the Wi-Fi details to the plug. Then try again, or contact support.`,
  },
  {
    category: "troubleshooting",
    slug: "harbor-motion-alerts",
    title: "Too many or too few motion alerts from a Harbor camera",
    summary:
      "Tune motion sensitivity and activity zones, and check that notifications are allowed on your phone.",
    tags: ["harbor", "camera", "alerts"],
    published: true,
    body: `## Too many alerts

- **Lower the sensitivity:** in the app choose the camera, then **Settings**, then **Motion**.
- **Draw activity zones** around the areas you care about, such as a door, so passing cars or a television outside the zones don't trigger alerts.
- **Turn on person detection** to be alerted for people only. It's included with cloud recording.

## No alerts

- Check that notifications are allowed for the Harbor app in your phone's settings, and that the app isn't in a battery-saving mode that blocks them.
- In the app, check that **Motion alerts** are on and that a schedule isn't pausing them.
- Make sure the camera is online; see [Harbor Indoor Camera shows as offline](/help/harbor-camera-offline).

## Alerts arrive late

Alerts need the camera and your phone online. On slow connections they can arrive up to a minute after the motion; the clip itself is always recorded.`,
  },
  {
    category: "troubleshooting",
    slug: "restart-or-factory-reset",
    title: "Restart or factory reset a device",
    summary:
      "Holding a device's button for 5 seconds restarts it; 10 seconds resets it to factory settings and removes it from your account.",
    tags: ["reset", "restart", "setup"],
    published: true,
    body: `## Restart first

A restart fixes most problems and keeps your settings. Hold the device's button for **5 seconds**, then let go. The Tempo Smart Thermostat restarts from **Settings**, then **Restart** on the thermostat itself.

## Factory reset

A factory reset removes the device from your account and erases its settings, schedules and Wi-Fi details. You'll need to set it up again in the app.

| Device | How to reset |
| --- | --- |
| Quill Smart Plug | Hold the button for 10 seconds, until the light flashes blue |
| Lumen Desk Lamp | Hold the power button for 10 seconds, until the lamp blinks twice |
| Harbor Indoor Camera | Press the reset hole with a pin for 10 seconds |
| Nimbus Mesh Router | Hold the reset button on the main node for 10 seconds |
| Tempo Smart Thermostat | On the thermostat choose **Settings**, then **Reset** |
| Pace Fitness Band | In the app choose **Device**, then **Reset** |

## Selling or giving a device away

Remove it from your account in the app first, then factory reset it, so the new owner can pair it.`,
  },
  {
    category: "troubleshooting",
    slug: "lumen-lighting-scenes",
    title: "Lighting scenes for the Lumen Desk Lamp",
    summary:
      "Draft: scenes that change brightness and colour temperature through the day, coming in a future app release.",
    tags: ["lumen", "lamp", "scenes"],
    published: false,
    body: `## What scenes do

A scene sets the lamp's brightness and colour temperature at times you choose, for example bright and cool in the morning and warm in the evening.

## Setting one up

1. In the app choose the lamp, then **Scenes**.
2. Pick a ready-made scene or create your own.`,
  },
];
