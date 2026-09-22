import { after, before } from "@vendetta/patcher";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { React, ReactNative } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

storage.removeBanner ??= true;
storage.exemptFriends ??= true;
storage.bannerExceptions ??= [];
storage.debugLogSheets ??= false; // flip true temporarily to log ActionSheet props
storage.keepCustomBanners ??= true; // keep banners set by plugins like UserBG
storage.exemptSelf ??= true; // never hide your own banner

let patches = [];

const getCurrentUserId = () => {
  try {
    const store = findByStoreName("UserStore");
    return store?.getCurrentUser?.()?.id ?? null;
  } catch {
    return null;
  }
};

const isFriend = (id) => {
  if (!id) return false;
  try {
    const store = findByStoreName("RelationshipStore");
    if (!store) return false;
    if (store.isFriend) return store.isFriend(id);
    return store.getRelationshipType?.(id) === 1;
  } catch {
    return false;
  }
};

const isExempt = (id) => {
  if (!id) return false;
  const strId = String(id);
  if (storage.exemptSelf && strId === String(getCurrentUserId())) return true;
  if (storage.bannerExceptions.includes(strId)) return true;
  if (storage.exemptFriends && isFriend(strId)) return true;
  return false;
};

const BANNER_FIELDS = ["banner", "bannerColor"];

// UserBG-style plugins override the banner URL with an image hosted
// elsewhere (their own asset host / a user-picked URL), while leaving
// Discord's own banner resolution untouched under the hood. We want to
// strip Discord's real banners but never touch a banner URL that isn't
// actually coming from Discord's CDN — that's how we tell "real Discord
// banner" apart from "banner injected by another plugin".
const DISCORD_CDN_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"];
const DISCORD_HASH_RE = /^a_?[0-9a-f]{32}$/i;

const isDiscordCdnBannerUrl = (url) => {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return DISCORD_CDN_HOSTS.includes(u.hostname) && /\/banners\//.test(u.pathname);
  } catch {
    return false;
  }
};

// Given any string value found in a "banner"-ish field, decide whether it's
// safe to strip: either a real Discord CDN banner URL, or a raw Discord
// banner hash (the format Discord stores on the user object before it's
// turned into a URL). Anything else — a custom host, a data URL, a plugin's
// own asset path — is assumed to belong to something like UserBG and is
// left alone.
const shouldStripBannerValue = (val) => {
  if (typeof val !== "string") return true;
  if (isDiscordCdnBannerUrl(val)) return true;
  if (DISCORD_HASH_RE.test(val)) return true;
  return false;
};

// Returns a version of obj with banner fields nulled, WITHOUT losing its
// prototype chain. A plain `{ ...obj }` spread strips the class prototype,
// which drops methods other parts of Discord expect to still exist on the
// object — that's what caused "undefined is not a function" crashes.
const withNulledFields = (obj, fields) => {
  if (!obj || typeof obj !== "object") return obj;

  const fieldsToNull = fields.filter((f) => {
    if (f !== "banner") return true; // bannerColor etc. always safe to strip
    if (!storage.keepCustomBanners) return true;
    return shouldStripBannerValue(obj[f]);
  });

  // Prefer the record's own immutable update method if it has one (common
  // on Immutable.js-style records) — safest, keeps all invariants intact.
  if (typeof obj.set === "function") {
    let next = obj;
    for (const f of fieldsToNull) {
      try {
        next = next.set(f, null);
      } catch {
        // field not present on this record type — ignore
      }
    }
    return next;
  }

  // Fallback: clone onto the same prototype so any class methods
  // (getAvatarURL, etc.) keep working after the copy.
  const clone = Object.create(Object.getPrototypeOf(obj));
  Object.assign(clone, obj);
  for (const f of fieldsToNull) clone[f] = null;
  return clone;
};

const stripBannerFields = (obj) => withNulledFields(obj, BANNER_FIELDS);

// Server-specific ("per-guild") profiles carry their own banner override,
// nested under a key that's commonly `guildMemberProfile`. If the field
// name differs on your client build, inspect a live getUserProfile()
// result in the debugger and adjust the key below.
const GUILD_PROFILE_KEY = "guildMemberProfile";

const applyBannerState = (profile, id) => {
  if (!profile || typeof profile !== "object" || !id) return profile;
  if (!storage.removeBanner || isExempt(id)) return profile;

  let result = stripBannerFields(profile);

  if (result[GUILD_PROFILE_KEY]) {
    // Overwrite the one property rather than spreading the whole object,
    // so result keeps whatever prototype stripBannerFields gave it.
    result[GUILD_PROFILE_KEY] = stripBannerFields(result[GUILD_PROFILE_KEY]);
  }

  return result;
};

const safe = (fn) => (...args) => {
  try {
    return fn(...args);
  } catch {
    return undefined;
  }
};

const idFromArgs = (args, res) =>
  res?.id ?? res?.userId ?? res?.user?.id ??
  args?.[0]?.id ?? args?.[0] ??
  args?.[1]?.id ?? args?.[1];

// Deep, generic sweep for banner-shaped fields inside an arbitrary object
// (e.g. ActionSheet props passed straight into openLazy). Used when we don't
// know the exact shape ahead of time — walks nested objects/arrays a few
// levels deep and nulls out anything matching BANNER_FIELDS or a banner URL
// string, without touching functions or breaking prototypes on the way.
const deepStripBanners = (value, seen = new WeakSet(), depth = 0) => {
  if (!value || typeof value !== "object" || depth > 4) return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = deepStripBanners(value[i], seen, depth + 1);
    }
    return value;
  }

  for (const key of Object.keys(value)) {
    if (typeof value[key] === "function") continue;

    if (/^bannercolor$/i.test(key)) {
      value[key] = null;
    } else if (/^banner$/i.test(key) || (/banner/i.test(key) && typeof value[key] === "string")) {
      if (!storage.keepCustomBanners || shouldStripBannerValue(value[key])) {
        value[key] = null;
      }
    } else if (value[key] && typeof value[key] === "object") {
      value[key] = deepStripBanners(value[key], seen, depth + 1);
    }
  }

  return value;
};

function Settings() {
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
  const [input, setInput] = React.useState("");
  const { FormSwitchRow, FormInput, FormRow, FormSection, FormDivider } = Forms;
  const { View, TouchableOpacity, Text } = ReactNative;
  const { ScrollView } = findByProps("ScrollView");
  const h = React.createElement;
  const UserStore = findByStoreName("UserStore");

  const addException = () => {
    const id = input.trim();
    if (!id) return;
    if (!/^\d+$/.test(id)) {
      showToast("Enter a valid user ID");
      return;
    }
    if (storage.bannerExceptions.includes(id)) {
      showToast("Already in the list");
      return;
    }
    storage.bannerExceptions.push(id);
    setInput("");
    forceUpdate();
    showToast("Added to exceptions");
  };

  const removeException = (id) => {
    storage.bannerExceptions = storage.bannerExceptions.filter((x) => x !== id);
    forceUpdate();
  };

  return h(
    ScrollView, // switched from View to ScrollView cuz someone forgot 
    { style: { flex: 1 }, contentContainerStyle: { paddingBottom: 24 } },
    h(
      View,
      null,
      h(
        FormSection,
        { title: "General" },
        h(FormSwitchRow, {
          label: "Remove banners",
          subLabel: "Strips banners from users everywhere, including server profiles",
          value: storage.removeBanner,
          onValueChange: (v) => {
            storage.removeBanner = v;
            forceUpdate();
          },
        }),
        h(FormSwitchRow, {
          label: "Don't hide my own banner",
          subLabel: "Always show your own profile banner to yourself",
          value: storage.exemptSelf,
          onValueChange: (v) => {
            storage.exemptSelf = v;
            forceUpdate();
          },
        }),
        h(FormSwitchRow, {
          label: "Keep friends' banners",
          subLabel: "Friends are automatically whitelisted",
          value: storage.exemptFriends,
          onValueChange: (v) => {
            storage.exemptFriends = v;
            forceUpdate();
          },
        }),
        h(FormSwitchRow, {
          label: "Keep custom banners",
          subLabel: "Don't strip banners set by plugins like UserBG",
          value: storage.keepCustomBanners,
          onValueChange: (v) => {
            storage.keepCustomBanners = v;
            forceUpdate();
          },
        })
      ),
      h(
        FormSection,
        { title: "Other exceptions" },
        h(FormInput, {
          title: "User ID",
          placeholder: "Add a non-friend's user ID to keep their banner",
          value: input,
          onChange: setInput,
          onSubmitEditing: addException,
          returnKeyType: "done",
        }),
        h(
          TouchableOpacity,
          {
            onPress: addException,
            style: {
              marginHorizontal: 16,
              marginTop: 8,
              marginBottom: 4,
              paddingVertical: 10,
              borderRadius: 8,
              backgroundColor: "#5865F2",
              alignItems: "center",
            },
          },
          h(Text, { style: { color: "#fff", fontWeight: "600" } }, "Add User ID")
        ),
        h(FormDivider, null),
        storage.bannerExceptions.length === 0 &&
          h(FormRow, { label: "No manual exceptions added" }),
        ...storage.bannerExceptions.map((id) => {
          const user = UserStore?.getUser?.(id);
          return h(FormRow, {
            key: id,
            label: user?.username ?? id,
            subLabel: id,
            onPress: () => removeException(id),
          });
        })
      ),
      h(
        FormSection,
        { title: "Debug" },
        h(FormSwitchRow, {
          label: "Log ActionSheet props",
          subLabel: "Logs UserProfile popout props to console for troubleshooting",
          value: storage.debugLogSheets,
          onValueChange: (v) => {
            storage.debugLogSheets = v;
            forceUpdate();
          },
        })
      )
    )
  );
}

export default {
  onLoad() {
    const unloadPatches = () => patches.forEach((p) => p?.());

    const applyPatches = () => {
      unloadPatches();
      patches = [];

      // --- Original targeted patches (kept — cheap, and correct when they hit) ---

      const userStore = findByStoreName("UserStore");
      if (userStore?.getUser) {
        patches.push(
          after("getUser", userStore, safe((args, res) => {
            if (!res) return res;
            return applyBannerState(res, res.id);
          }))
        );
      }

      const userProfileStore = findByStoreName("UserProfileStore");
      if (userProfileStore?.getUserProfile) {
        patches.push(
          after("getUserProfile", userProfileStore, safe((args, res) => {
            if (!res) return res;
            const id = res.userId ?? res.user?.id ?? args?.[0];
            const next = applyBannerState(res, id);
            if (next.user) next.user = applyBannerState(next.user, id);
            return next;
          }))
        );
      }

      const guildMemberProfileStore = findByStoreName("GuildMemberProfileStore");
      if (guildMemberProfileStore?.getGuildMemberProfile) {
        patches.push(
          after("getGuildMemberProfile", guildMemberProfileStore, safe((args, res) => {
            if (!res) return res;
            const id = res.userId ?? args?.[1] ?? args?.[0];
            return applyBannerState(res, id);
          }))
        );
      }

      const bannerUrlMod = findByProps("getUserBannerURL", "getUserAvatarURL");
      if (bannerUrlMod?.getUserBannerURL) {
        patches.push(
          after("getUserBannerURL", bannerUrlMod, safe((args, url) => {
            const id = args?.[0]?.id ?? args?.[0];
            if (!storage.removeBanner || isExempt(id)) return url;
            if (storage.keepCustomBanners && !shouldStripBannerValue(url)) return url;
            return null;
          }))
        );
      }

      if (bannerUrlMod?.getGuildMemberBannerURL) {
        patches.push(
          after("getGuildMemberBannerURL", bannerUrlMod, safe((args, url) => {
            const id = args?.[0]?.userId ?? args?.[0]?.id ?? args?.[1];
            if (!storage.removeBanner || isExempt(id)) return url;
            if (storage.keepCustomBanners && !shouldStripBannerValue(url)) return url;
            return null;
          }))
        );
      }

      const hookMod = findByProps("useUserBanner");
      if (hookMod?.useUserBanner) {
        patches.push(
          after("useUserBanner", hookMod, safe((args, url) => {
            const id = args?.[0];
            if (!storage.removeBanner || isExempt(id)) return url;
            if (storage.keepCustomBanners && !shouldStripBannerValue(url)) return url;
            return null;
          }))
        );
      }

      // --- Generic sweep: catches whatever accessor the per-server popout
      // actually uses, even if its exact method name isn't one of the above ---

      const allStoreNames = [
        "UserStore",
        "UserProfileStore",
        "GuildMemberProfileStore",
        "GuildMemberStore",
        "GuildStore",
      ];

      allStoreNames.forEach((name) => {
        const store = findByStoreName(name);
        if (!store) return;

        const proto = Object.getPrototypeOf(store);
        const methodNames = Object.getOwnPropertyNames(proto).filter(
          (k) =>
            typeof store[k] === "function" &&
            /banner/i.test(k) &&
            !/^(set|update|_)/i.test(k)
        );

        methodNames.forEach((methodName) => {
          patches.push(
            after(methodName, store, safe((args, res) => {
              if (!res) return res;
              const id = idFromArgs(args, res);
              if (!storage.removeBanner || isExempt(id)) return res;

              // If it returns a URL/string directly, only null it if it's a
              // genuine Discord banner — leave custom (e.g. UserBG) URLs alone
              if (typeof res === "string") {
                if (storage.keepCustomBanners && !shouldStripBannerValue(res)) return res;
                return null;
              }

              // Otherwise treat it as an object/record and strip banner fields
              let next = applyBannerState(res, id);

              if (next?.user) next.user = applyBannerState(next.user, id);
              if (next?.guildMemberProfile) {
                next.guildMemberProfile = applyBannerState(next.guildMemberProfile, id);
              }
              return next;
            }))
          );
        });
      });

      const bannerPropsSweep = findByProps("getUserBannerURL", "getUserAvatarURL");
      if (bannerPropsSweep) {
        Object.keys(bannerPropsSweep)
          .filter((k) => typeof bannerPropsSweep[k] === "function" && /banner/i.test(k))
          .forEach((fnName) => {
            patches.push(
              after(fnName, bannerPropsSweep, safe((args, url) => {
                if (!url) return url;
                const id = args?.[0]?.id ?? args?.[0] ?? args?.[1]?.id ?? args?.[1];
                if (!storage.removeBanner || isExempt(id)) return url;
                if (typeof url !== "string") return url;
                if (storage.keepCustomBanners && !shouldStripBannerValue(url)) return url;
                return null;
              }))
            );
          });
      }

      // --- ActionSheet interception: covers UserProfile popouts whose
      // banner data is baked into the sheet's props at open-time, rather
      // than fetched from a store getter after mount (per ActionSheetFinder,
      // this popout is registered as "UserProfile<id>"). We patch the sheet
      // opener itself and strip any banner-shaped field from its props
      // before the sheet ever renders. ---

      const sheetsMod =
        findByProps("openLazy", "hideActionSheet") ||
        findByProps("openLazy") ||
        findByProps("hideActionSheet");

      if (sheetsMod?.openLazy) {
        patches.push(
          before("openLazy", sheetsMod, safe((args) => {
            // args[1] is typically the sheet key (e.g. "UserProfile..."),
            // args[2] is typically the props object passed to the component.
            const key = args?.[1];
            if (typeof key !== "string" || !key.startsWith("UserProfile")) return;

            const props = args?.[2];
            if (!props || typeof props !== "object") return;

            const id =
              props.userId ?? props.user?.id ?? props.id ??
              (key.match(/UserProfile(\d+)/)?.[1]);

            if (storage.debugLogSheets) {
              try {
                console.log(
                  "[bannerdebug] openLazy key:", key,
                  "props:", JSON.stringify(props, (k, v) => (typeof v === "function" ? "[fn]" : v), 2)
                );
              } catch {
                console.log("[bannerdebug] openLazy key:", key, "(props not JSON-serializable)");
              }
            }

            if (!storage.removeBanner || isExempt(id)) return;

            deepStripBanners(props);
          }))
        );
      }
    };

    applyPatches();
  },
  onUnload() {
    patches.forEach((p) => p?.());
  },
  settings: Settings,
};
