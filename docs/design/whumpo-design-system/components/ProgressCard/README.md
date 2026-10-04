# ProgressCard

Long-running work shown as real workflow steps with an overall ring.

- Provide `title` ("Setting up your website") and `steps` [{label, state: done | active | pending}]; `percent` defaults to done/total.
- Step labels are outcomes in plain words ("Registering domain", "Going live"), never provider or pipeline jargon.
- Only advance a step when the workflow reports it; the mascot never celebrates before this card is complete.
