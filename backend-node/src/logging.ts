const whitelistLogTags = (whitelist: Array<string>) => ({
  whitelist: whitelist,
  createTaggedLogger: (tag: string) => {
    if (
      Array.isArray(tag)
        ? tag.some((tagElement) => whitelist.includes(tagElement))
        : whitelist.includes(tag)
    ) {
      return ((...args: any | any[]) => { console.log(...args); });
    } else {
      return ((_: any | any[]) => {});
    }
  },
});

const logging = whitelistLogTags(["event", "state", "method", "test"]);

export const logTest = logging.createTaggedLogger("test");
export const logEvent = logging.createTaggedLogger("event");
export const logState = logging.createTaggedLogger("state");
export const logMethod = logging.createTaggedLogger("method");
