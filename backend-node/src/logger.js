export const whitelistLogTags = (whitelist) => ({
  whitelist: whitelist,
  createTaggedLogger: (tag) => (
    whitelist.includes(tag)
      ? (message) => { console.log(message); }
      : (_) => {}
  ),
});