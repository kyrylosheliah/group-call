export const whitelistLogTags = (whitelist) => ({
  whitelist: whitelist,
  createTaggedLogger: (tag) => {
    if (
      Array.isArray(tag)
        ? tag.some((tagElement) => whitelist.includes(tagElement))
        : whitelist.includes(tag)
    ) {
      return ((message) => { console.log(message); });
    } else {
      return ((_) => {});
    }
  },
});
