import type { CuratedBookCopy } from './curated-book-copy';
type CuratedBookBase = { id: number; title: string; titleZh: string; author: string; intro: string; category: string; tags: string[]; difficulty: '相对容易' | '中等' | '较难' | '挑战级'; takeaway: string };
export type CuratedBook = CuratedBookBase & CuratedBookCopy;
// Editorial descriptions and relative difficulty are original Vantilo guidance, not formal reading-level scores.
export const CURATED_BOOKS: CuratedBookBase[] = [
  {id:215,title:'The Call of the Wild',titleZh:'野性的呼唤',author:'Jack London',intro:'巴克从安逸生活被带到北方荒野，在严酷环境中学习生存，也逐渐听见来自自然的召唤。',category:'冒险与生存',tags:['荒野','动物','生存'],difficulty:'中等',takeaway:'观察环境如何塑造选择，体会忠诚、适应与自由的张力。'},
  {id:35,title:'The Time Machine',titleZh:'时间机器',author:'H. G. Wells',intro:'一位发明家乘坐时间机器驶向遥远未来，遇见分化的社会与陌生的人类生活。',category:'科幻',tags:['时间旅行','未来社会','发明'],difficulty:'较难',takeaway:'练习从故事设定追问：技术与社会会怎样共同变化？'},
  {id:120,title:'Treasure Island',titleZh:'金银岛',author:'Robert Louis Stevenson',intro:'少年吉姆发现一张海图，随船踏上寻宝航程，在海上结识伙伴，也面对危险与信任考验。',category:'冒险与生存',tags:['海盗','航海','寻宝'],difficulty:'中等',takeaway:'留意叙述者如何观察他人，并思考勇气与判断的关系。'},
  {id:84,title:'Frankenstein; Or, The Modern Prometheus',titleZh:'弗兰肯斯坦',author:'Mary Wollstonecraft Shelley',intro:'科学探索越过边界后，创造者与被创造者都必须面对孤独、责任和社会偏见。',category:'科幻',tags:['科学伦理','孤独','哥特'],difficulty:'挑战级',takeaway:'从多重叙述中讨论创造、责任与接纳。'},
  {id:11,title:"Alice's Adventures in Wonderland",titleZh:'爱丽丝漫游奇境',author:'Lewis Carroll',intro:'爱丽丝追随一只白兔进入奇异世界，遇到古怪规则、谜语和不断变化的角色。',category:'成长故事',tags:['奇幻','语言游戏','想象力'],difficulty:'中等',takeaway:'观察文字游戏和逻辑反转如何制造幽默。'},
  {id:16,title:'Peter Pan',titleZh:'彼得·潘',author:'J. M. Barrie',intro:'温蒂和弟弟们前往永无岛，在飞行、海盗与奇妙伙伴之间经历一场关于成长的冒险。',category:'成长故事',tags:['奇幻','友谊','成长'],difficulty:'中等',takeaway:'思考童年想象与长大后的责任如何并存。'},
  {id:74,title:'The Adventures of Tom Sawyer',titleZh:'汤姆·索亚历险记',author:'Mark Twain',intro:'汤姆在密西西比河畔的日常里总能找到新点子，和朋友们经历淘气、探险与成长。',category:'成长故事',tags:['童年','友谊','美国生活'],difficulty:'较难',takeaway:'从幽默的叙述中认识社区生活与少年视角。'},
  {id:76,title:'Adventures of Huckleberry Finn',titleZh:'哈克贝利·费恩历险记',author:'Mark Twain',intro:'哈克与吉姆沿密西西比河同行，旅途让他们不断面对偏见、选择与彼此的信任。',category:'历史与社会',tags:['河流','友谊','社会观察'],difficulty:'挑战级',takeaway:'关注人物选择与时代偏见；作品含历史语境中的种族用语。'},
  {id:1661,title:'The Adventures of Sherlock Holmes',titleZh:'福尔摩斯探案集',author:'Arthur Conan Doyle',intro:'医生华生记录福尔摩斯处理的一系列案件，细节、证词与推理一步步连成线索。',category:'悬疑推理',tags:['侦探','观察','短篇'],difficulty:'中等',takeaway:'练习区分观察到的事实与推理出的结论。'},
  {id:244,title:'A Study in Scarlet',titleZh:'血字的研究',author:'Arthur Conan Doyle',intro:'华生初识福尔摩斯，两人合作调查一桩离奇命案，案件线索逐渐指向更远的往事。',category:'悬疑推理',tags:['侦探','搭档','案件'],difficulty:'较难',takeaway:'观察搭档关系如何帮助读者理解复杂推理。'},
  {id:1342,title:'Pride and Prejudice',titleZh:'傲慢与偏见',author:'Jane Austen',intro:'伊丽莎白与达西在家庭、礼节和初印象之间相识，彼此重新认识的过程带出机智的社会观察。',category:'历史与社会',tags:['家庭','社会观察','机智'],difficulty:'挑战级',takeaway:'感受反讽语气，并观察阶层与婚姻选择。'},
  {id:98,title:'A Tale of Two Cities',titleZh:'双城记',author:'Charles Dickens',intro:'故事往返于伦敦与巴黎，几个人物的命运交织在法国大革命前后的动荡年代。',category:'历史与社会',tags:['法国大革命','命运','城市'],difficulty:'挑战级',takeaway:'通过人物命运理解社会动荡对普通人的影响。'},
  {id:1400,title:'Great Expectations',titleZh:'远大前程',author:'Charles Dickens',intro:'孤儿匹普获得改变生活的机会，在成长中重新审视财富、友谊与自己想成为的人。',category:'成长故事',tags:['成长','阶层','自我认识'],difficulty:'挑战级',takeaway:'追踪主人公对成功与善意的理解如何改变。'},
  {id:46,title:'A Christmas Carol',titleZh:'圣诞颂歌',author:'Charles Dickens',intro:'吝啬的商人斯克鲁奇在圣诞夜经历一段非同寻常的回望，重新看待自己与他人的关系。',category:'成长故事',tags:['改变','善意','节日'],difficulty:'相对容易',takeaway:'留意象征和对照如何推动人物转变。'},
  {id:2591,title:'Flatland: A Romance of Many Dimensions',titleZh:'平面国',author:'Edwin Abbott Abbott',intro:'一个生活在二维世界的正方形，遇到更高维度的存在，开始重新想象空间与社会。',category:'自然与科学',tags:['几何','维度','社会寓言'],difficulty:'较难',takeaway:'用几何想象理解维度，也辨认寓言中的社会批评。'},
  {id:55,title:'The Wonderful Wizard of Oz',titleZh:'绿野仙踪',author:'L. Frank Baum',intro:'多萝西被带到陌生国度，与新伙伴结伴寻找回家的路和各自想要的东西。',category:'冒险与生存',tags:['奇幻','伙伴','旅程'],difficulty:'相对容易',takeaway:'发现勇气、智慧与关怀如何体现在日常行动中。'},
  {id:1257,title:'The Three Musketeers',titleZh:'三个火枪手',author:'Alexandre Dumas',intro:'年轻的达达尼昂来到巴黎，与三位火枪手结为伙伴，卷入宫廷中的冒险与阴谋。',category:'历史与社会',tags:['历史冒险','伙伴','法国'],difficulty:'挑战级',takeaway:'关注伙伴情谊，也留意长篇历史小说的叙事节奏。'},
  {id:203,title:'The War of the Worlds',titleZh:'世界大战',author:'H. G. Wells',intro:'英国小镇遭遇来自火星的威胁，叙述者记录人们在未知危机中的慌乱与应对。',category:'科幻',tags:['外星来客','危机','科学想象'],difficulty:'较难',takeaway:'把握第一人称危机叙事；小说设定不代表真实天文学。'},
  {id:45,title:'Anne of Green Gables',titleZh:'绿山墙的安妮',author:'L. M. Montgomery',intro:'想象力丰富的安妮来到绿山墙农舍，在新家、新朋友和小小失误中慢慢找到归属。',category:'成长故事',tags:['友谊','家庭','成长'],difficulty:'中等',takeaway:'体会表达自我、建立友谊与融入新环境的过程。'},
];
import { CURATED_BOOK_COPY } from './curated-book-copy';
export const CURATED_BOOKS_V01: CuratedBook[] = CURATED_BOOKS.map(book => ({...book,...CURATED_BOOK_COPY[book.id]}));
export const BOOK_CATEGORIES = ['全部','冒险与生存','科幻','悬疑推理','自然与科学','历史与社会','成长故事'];
export const ONLINE_CATEGORY_TOPICS: Record<string, string> = {
  '冒险与生存': 'adventure survival',
  '科幻': 'science fiction',
  '悬疑推理': 'mystery detective',
  '自然与科学': 'nature science',
  '历史与社会': 'history society',
  '成长故事': 'coming of age'
};
