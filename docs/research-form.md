# Trailhead research page

One mobile web page. One worldwide link. English labels for now. The page records a visit to a trailhead. It does not collect a name or an email.

People use it at the lot or later the same day. The arrival time is the time at the trailhead, not the time zone of the phone they happen to be holding.

## Map

The map shows two kinds of pins for the area on screen:

- Trailheads (`highway=trailhead`)
- Parking lots (`amenity=parking`)

Search uses a short name and only looks inside the current map, about 50 km around the center. The page says where it is searching, for example “Searching near North Bend.” If they pan to Australia, the same box searches there. A short name never searches the whole planet.

Tapping a pin selects that place. The page copies the OpenStreetMap id, name, and coordinates.

A pin they drop is checked against nearby trailheads and parking lots, within a few hundred meters.

- If one is close, the page asks “Is this Mount Si Trailhead Parking?” Yes selects that place. No asks them to type a short name.
- If nothing is close, they type a short name. The point and that name stay in this database. They are not sent to OpenStreetMap.

When a parking lot sits within a few hundred meters of a trailhead, the page treats them as one visit and keeps both ids.

## Shown from the map, not asked

If OpenStreetMap already has the fact, the page displays it and the form skips that question.

| Tag | What the page shows |
| --- | --- |
| `name` | Place name |
| `capacity` | About N spaces |
| `capacity:disabled` | Accessible spaces, when present |
| `fee=yes` or `fee=no` | Pass required, or no fee listed |
| `opening_hours` | Hours |
| `surface` | Surface, such as gravel or asphalt |
| A toilet tagged at the place | Bathrooms are listed. The form only asks their condition. |

Mailbox Peak Trail Parking Lot (way 348438600) has capacity 45, a fee, and hours. Mount Si Trailhead Parking (way 40032953) has a fee and a gravel surface, and no capacity. The Mailbox trailhead node (53207063) is the trailhead pin next to that lot.

There is no question that asks someone to guess the lot size. If the map has no capacity, the page leaves the number blank.

## Questions

The place comes from the map. The form then asks:

1. **Date and time you arrived.** Defaults to now at the trailhead. The label names the trailhead zone, such as Pacific time.
2. **Was there a designated parking lot?** Yes / No, street or pullout only / Not sure.
3. **Only if Yes or Not sure: Could you park in the lot?** Room to spare / A few spots left / Lot full / Turned around.
4. **Optional: About how many cars were in the lot?** 0 / 1–5 / 6–15 / 15+ / Didn’t count.
5. **Your group.** Vehicles: 1 / 2 / 3 or more. People: 1 / 2–3 / 4–6 / 7 or more.
6. **How long were you there?** Under 2 hours / 2–4 / 4–6 / 6 or more.
7. **Pass.** If the map already says a fee is required, skip “was a pass required?” and ask only whether the fee machine or envelope box was Working / Broken or empty / None, because they used a pass or paid elsewhere. If the map has no fee tag, ask Yes / No / Not sure, then the machine question only when they say yes.
8. **Bathrooms.** If a toilet is already tagged, ask only OK / Needs attention / Closed. Otherwise ask Yes / No / Didn’t check, and the condition only when they say yes.
9. **Optional: How often do you come here?** First time / A few times a year / Most months / Weekly.

No name, email, comment box, or guessed capacity.

The page uses large tap targets, text labels, and one main action at a time so it can be filled on a phone in a parking lot.

## Time

Each report stores:

- `arrived_at` as a UTC instant
- `timezone` as a name taken from the coordinates, such as `America/Los_Angeles`

The picker edits the wall time in that zone. Submitting later from another country does not change what 8:30 means at the trail.

## What is stored

One row per visit:

- OpenStreetMap type and id when they picked an existing pin, or empty when they named a new pin
- Name, latitude, longitude
- Timezone and `arrived_at` in UTC
- The answers above, as fixed choices
- Map facts copied at submit time: capacity, fee, opening hours, surface, when present

New pins stay in this database until a person reviews them. This phase does not write notes or edits to OpenStreetMap.

## What can be shared later

Public pages and any later annual summary use counts and buckets only, with the number of reports and the date range. Example: “Mount Si, Saturday mornings, 8 of 12 reports could not park in the lot.”

Do not publish raw rows, exact minutes tied to one visit, typed names of unreviewed pins, or free text. Do not present a map capacity as an official count. Label it as map data.

## How it will be built

The first version is a small website in this repo.

- One Python service stores the visit and answers the map search for the current view.
- One page draws the map, the pins, and the form.
- Map data is read from OpenStreetMap. Search is limited to the current view. The service sends a proper user agent and does not query on every keystroke.
- Reports sit in a database that can later move to the phone app without a new shape.
- The page is hosted on a free static host plus the small service. A short link can point at it. A custom domain can wait.

The iPhone app is a later client of the same reports. It is not required to collect the first season.
