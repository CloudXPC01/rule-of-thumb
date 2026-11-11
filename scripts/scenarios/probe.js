const g = globalThis.__god; const r = g.renderer; const sc = g.world.scene;
return { alpha: r.getClearAlpha(), bg: sc.background ? (sc.background.isColor ? 'color ' + sc.background.getHexString() : sc.background.constructor.name) : null,
  ctxAlpha: r.getContext().getContextAttributes().alpha, cam: g.world.camera.position.toArray(), camQ: g.world.camera.quaternion.toArray(), stage: g.worldRoot.parent.position.toArray(),
  canvasParent: r.domElement.parentElement?.id, bodyBg: getComputedStyle(document.body).backgroundColor, fov: g.world.camera.fov };
