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

//const logging = whitelistLogTags(["stage1", "stage2"]);
const logging = whitelistLogTags([]);

export const log1stage = logging.createTaggedLogger("stage1");
export const log2stage = logging.createTaggedLogger("stage2");