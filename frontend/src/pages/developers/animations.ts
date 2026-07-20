export const slidePanel = {
  hidden:  { x: 480, opacity: 0 },
  visible: { x: 0, opacity: 1,   transition: { type: 'tween' as const, duration: 0.18 } },
  exit:    { x: 480, opacity: 0, transition: { type: 'tween' as const, duration: 0.14 } },
}

export const fadeUp = {
  hidden:  { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0,  transition: { duration: 0.14 } },
  exit:    { opacity: 0, y: -4, transition: { duration: 0.1 } },
}

export const scaleIn = {
  hidden:  { scale: 0.96, opacity: 0 },
  visible: { scale: 1, opacity: 1,   transition: { type: 'tween' as const, duration: 0.15 } },
  exit:    { scale: 0.96, opacity: 0, transition: { type: 'tween' as const, duration: 0.1 } },
}
