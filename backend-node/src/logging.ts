const whitelistLogTags = (whitelist: Array<string>) => ({
  whitelist: whitelist,
  createTaggedLogger: (tag: string) => {
    if (
      Array.isArray(tag)
        ? tag.some((tagElement) => whitelist.includes(tagElement))
        : whitelist.includes(tag)
    ) {
      return ((message: any) => { console.log(message); });
    } else {
      return ((_: any) => {});
    }
  },
});

//const logging = whitelistLogTags(["stage1", "stage2"]);
const logging = whitelistLogTags(["stage3"]);

export const log1stage = logging.createTaggedLogger("stage1");
export const log2stage = logging.createTaggedLogger("stage2");
export const log3stage = logging.createTaggedLogger("stage3");