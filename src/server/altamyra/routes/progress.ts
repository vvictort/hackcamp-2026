import type { Hono } from 'hono'
import { AimlineResponse, ProficiencyResponse, ProficiencySetBody, WhatWorksResponse } from '../contract/api'
import type { AltamyraEnv } from '../middleware/auth'
import { aimlineGet, proficiencySet, whatWorksGet } from '../services/insight'
import type { Kit } from './context'

/** Insight views and proficiency. */
export function progressRoutes(app: Hono<AltamyraEnv>, kit: Kit): void {
  const { mw, signedIn, studentRef, req } = kit

  app.get('/students/:id/goals/:gid/aimline', signedIn, mw.requireCapability('progress.view'), async (c) => {
    const r = req(c)
    return r.json(AimlineResponse, await r.student(r.param('id'), aimlineGet, { goalId: r.param('gid') }))
  })

  app.get('/students/:id/what-works', signedIn, mw.requireCapability('progress.view'), async (c) => {
    const r = req(c)
    return r.json(WhatWorksResponse, await r.student(r.param('id'), whatWorksGet))
  })

  app.post('/goals/:gid/proficiency', signedIn, studentRef, mw.requireCapability('proficiency.set'), async (c) => {
    const r = req(c)
    const body = await r.body(ProficiencySetBody)
    return r.json(ProficiencyResponse, await r.student(r.studentRef(), proficiencySet, { goalId: r.param('gid'), ...body }), 201)
  })
}
