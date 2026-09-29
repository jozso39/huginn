// The Slack shortcodes people actually use (iamcal emoji-data names). The full set
// is a megabyte; anything not here — including a workspace's custom emoji — is shown
// as :name:, which is what Slack's own plain-text rendering does too.
const TABLE = `
+1 👍|thumbsup 👍|-1 👎|thumbsdown 👎|ok_hand 👌|clap 👏|raised_hands 🙌|pray 🙏|wave 👋|muscle 💪
point_up 👆|point_down 👇|point_left 👈|point_right 👉|v ✌️|crossed_fingers 🤞|handshake 🤝|writing_hand ✍️|facepunch 👊|punch 👊
eyes 👀|brain 🧠|heart ❤️|orange_heart 🧡|yellow_heart 💛|green_heart 💚|blue_heart 💙|purple_heart 💜|broken_heart 💔|sparkling_heart 💖
smile 😄|smiley 😃|grinning 😀|grin 😁|laughing 😆|joy 😂|rolling_on_the_floor_laughing 🤣|sweat_smile 😅|slightly_smiling_face 🙂|upside_down_face 🙃
wink 😉|blush 😊|innocent 😇|heart_eyes 😍|star-struck 🤩|kissing_heart 😘|yum 😋|stuck_out_tongue 😛|stuck_out_tongue_winking_eye 😜|zany_face 🤪
thinking_face 🤔|face_with_monocle 🧐|neutral_face 😐|expressionless 😑|no_mouth 😶|smirk 😏|unamused 😒|face_with_rolling_eyes 🙄|grimacing 😬|relieved 😌
pensive 😔|sleepy 😪|sleeping 😴|mask 😷|nerd_face 🤓|sunglasses 😎|confused 😕|worried 😟|slightly_frowning_face 🙁|open_mouth 😮
astonished 😲|flushed 😳|pleading_face 🥺|cry 😢|sob 😭|scream 😱|disappointed 😞|sweat 😓|weary 😩|tired_face 😫
triumph 😤|rage 😡|angry 😠|exploding_head 🤯|partying_face 🥳|hugging_face 🤗|shushing_face 🤫|see_no_evil 🙈|hear_no_evil 🙉|speak_no_evil 🙊
skull 💀|ghost 👻|robot_face 🤖|poop 💩|hankey 💩|clown_face 🤡|100 💯|fire 🔥|sparkles ✨|star ⭐
star2 🌟|tada 🎉|confetti_ball 🎊|gift 🎁|trophy 🏆|medal 🏅|rocket 🚀|bulb 💡|zap ⚡|boom 💥
white_check_mark ✅|heavy_check_mark ✔️|ballot_box_with_check ☑️|x ❌|negative_squared_cross_mark ❎|warning ⚠️|no_entry 🚫|no_entry_sign 🚫|exclamation ❗|question ❓
grey_question ❔|bangbang ‼️|heavy_plus_sign ➕|heavy_minus_sign ➖|arrow_right ➡️|arrow_left ⬅️|arrow_up ⬆️|arrow_down ⬇️|arrows_counterclockwise 🔄|repeat 🔁
red_circle 🔴|large_blue_circle 🔵|large_green_circle 🟢|large_yellow_circle 🟡|large_orange_circle 🟠|white_circle ⚪|black_circle ⚫|small_red_triangle 🔺|pushpin 📌|round_pushpin 📍
paperclip 📎|link 🔗|lock 🔒|unlock 🔓|key 🔑|hammer_and_wrench 🛠️|wrench 🔧|gear ⚙️|mag 🔍|bell 🔔
calendar 📅|date 📅|spiral_calendar_pad 🗓️|clock1 🕐|hourglass ⏳|hourglass_flowing_sand ⏳|stopwatch ⏱️|alarm_clock ⏰|memo 📝|pencil ✏️
pencil2 ✏️|clipboard 📋|bookmark 🔖|books 📚|book 📖|email 📧|envelope ✉️|inbox_tray 📥|outbox_tray 📤|package 📦
chart_with_upwards_trend 📈|chart_with_downwards_trend 📉|bar_chart 📊|computer 💻|keyboard ⌨️|iphone 📱|phone ☎️|telephone_receiver 📞|bug 🐛|construction 🚧
rotating_light 🚨|coffee ☕|beer 🍺|beers 🍻|pizza 🍕|cake 🍰|birthday 🎂|sun_with_face 🌞|sunny ☀️|rainbow 🌈
snowflake ❄️|umbrella ☂️|earth_africa 🌍|globe_with_meridians 🌐|house 🏠|office 🏢|hospital 🏥|car 🚗|airplane ✈️|money_with_wings 💸
moneybag 💰|dollar 💵|euro 💶|chart 💹|speech_balloon 💬|thought_balloon 💭|loudspeaker 📢|mega 📣|zzz 💤|dart 🎯
checkered_flag 🏁|triangular_flag_on_post 🚩|flag-cz 🇨🇿|flag-sk 🇸🇰|flag-eu 🇪🇺|seedling 🌱|herb 🌿|four_leaf_clover 🍀|cat 🐱|dog 🐶
unicorn_face 🦄|turtle 🐢|snail 🐌|bee 🐝|eagle 🦅|owl 🦉|raven 🐦‍⬛|shrug 🤷|man-shrugging 🤷‍♂️|woman-shrugging 🤷‍♀️
facepalm 🤦|man-facepalming 🤦‍♂️|woman-facepalming 🤦‍♀️|raising_hand 🙋|ok_woman 🙆|no_good 🙅|salute 🫡|melting_face 🫠|saluting_face 🫡|heart_hands 🫶
`;

const EMOJI: ReadonlyMap<string, string> = new Map(
  TABLE.trim()
    .split(/[|\n]/)
    .map((entry) => entry.trim().split(' ') as [string, string])
    .filter(([name, char]) => Boolean(name) && Boolean(char))
);

/** `thumbsup::skin-tone-3` → 👍🏽; unknown names → null (shown as :name:). */
export const emojiFor = (shortcode: string): string | null => {
  const [name = '', tone] = shortcode.split('::');
  const base = EMOJI.get(name);
  const tones: Record<string, string> = {
    'skin-tone-2': '🏻',
    'skin-tone-3': '🏼',
    'skin-tone-4': '🏽',
    'skin-tone-5': '🏾',
    'skin-tone-6': '🏿',
  };

  return base ? `${base}${tone ? (tones[tone] ?? '') : ''}` : null;
};
