 /**
 * Fetches a random image from KonoChan.
 * @param isNSFW - Whether to include NSFW content.
 * @returns The URL of the fetched image or null if none are found.
 */
export const fetchImage = async (isNSFW: boolean): Promise<string | null> => {
  const baseURL = "https://konachan.com/post.json";
  const tag = isNSFW ? "rating:explicit" : "rating:safe";
  const randomPage = Math.floor(Math.random() * 100);

  try {
    const response = await fetch(`${baseURL}?tags=${tag}&limit=1&page=${randomPage}`);
    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      return null; // No image found
    }
    return data[0].file_url;
  } catch (error) {
    console.error("[KonoChan Randomizer] Error fetching image:", error);
    return null;
  }
};