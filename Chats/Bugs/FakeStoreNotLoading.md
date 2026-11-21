## Fake Store Not Loading

It's been a little while since I ran this last, so perhaps I've forgotten a step.

I'm running npm run serve from the o2h-edge directory, it is sunning on port 8000.

I'm also running npm run dev from the same directory, and it is listening on port 8788

I opened http://localhost:8000/demo/store/index.html and it is showing Loading... but I'm not seeing a store catalog, which I was expecting.

Can you please check if I'm missing a step, or if something has gone wrong?
## Claude's Response

**You didn't miss a step. The fault was mine.**

### What happened

- **A leftover worker of mine was holding port 8787.** On 2026-11-20 I ran `wrangler dev --port 8787` in the background for the BLS key check. When I stopped it, only `wrangler` (the Node process) was killed. On Windows, its child `workerd.exe` lives on unless the whole process tree is killed, and that child kept 8787. `test/edge.test.mjs` already kills the whole tree for this reason (`taskkill /T`). I didn't do the same.
- **So your `npm run dev` went to 8788.** Wrangler picks the next free port when 8787 is taken.
- **The page still asks 8787** (the Worker field defaults to `http://localhost:8787`). The orphan accepted the connection but never answered, since its `wrangler` was gone. The fetch had no timeout, so the page stayed on "Loading…" with no error.

### What I did

- Stopped the orphan: `workerd.exe` (PID 28872) and its `wrangler dev` (PID 27000), both started on 2026-11-20 at 5:56. 8787 is free now.
- Checked your setup as it stands: `http://localhost:8000/demo/store/index.html`, with the Worker field set to `http://localhost:8788`. The status line says "/, rendered by the worker in 773 ms", and there are 24 product links.

### For you

Either of these works:
- **Restart `npm run dev`.** It will get 8787 again, matching the page's default.
- **Or keep it on 8788,** and enter `http://localhost:8788` in the page's Worker field.

### Worth considering

**A hung worker shows "Loading…" forever.** mirror's fetch to the worker has no timeout, so this failure gave you nothing to go on. A timeout in mirror (say 15 s, configurable), reported through `onRender` as "the worker didn't answer within …", would have pointed straight at the port. It's a small change in navigate-gingerly. Shall I add it?
