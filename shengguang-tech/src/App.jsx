import { useEffect, useRef, useState } from "react";

const navItems = [
  { label: "简介", href: "#intro" },
  { label: "成员", href: "#members" },
  { label: "联系", href: "#contact" },
  { label: "关于", href: "#about" },
];

const members = [
  {
    role: "会长",
    name: "尤卓乐",
    note: "负责圣光会整体事务统筹与长期发展方向。",
  },
  {
    role: "会长",
    name: "李皓男",
    note: "负责组织协作、成员沟通与核心事务推进。",
  },
  {
    role: "副会长",
    name: "李华桥",
    note: "协助推进组织建设、会议沟通与项目执行。",
  },
  {
    role: "副会长",
    name: "谢家明",
    note: "协助推进成员联络、活动组织与日常协调。",
  },
];

const sectionScenes = {
  intro: {
    image: "/assets/bg-temple-core.png",
  },
  members: {
    image: "/assets/bg-members-direction2.png",
  },
  contact: {
    image: "/assets/scroll-sanctum-a.png",
  },
  about: {
    image: "/assets/hero-wuji-taiji.png",
  },
};

const cinematicEase = (progress) => {
  if (progress < 0.5) return 16 * progress ** 5;
  return 1 - Math.pow(-2 * progress + 2, 5) / 2;
};

function scrollToHref(href, options = {}) {
  if (!href.startsWith("#")) return 0;

  const id = href.slice(1);
  const element = document.getElementById(id);
  if (!element) return 0;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const topOffset = id === "top" ? 0 : options.offset ?? 108;
  const targetY = Math.max(element.getBoundingClientRect().top + window.scrollY - topOffset, 0);

  window.history.pushState(null, "", href);

  if (reducedMotion) {
    window.scrollTo({ top: targetY, behavior: "auto" });
    options.onComplete?.();
    return 0;
  }

  const startY = window.scrollY;
  const distance = targetY - startY;
  const duration = options.duration ?? Math.min(4200, Math.max(2200, 1500 + Math.abs(distance) * 0.92));
  const startTime = performance.now();

  const tick = (now) => {
    const progress = Math.min((now - startTime) / duration, 1);
    window.scrollTo({ top: startY + distance * cinematicEase(progress), behavior: "auto" });

    if (progress < 1) requestAnimationFrame(tick);
    else options.onComplete?.();
  };

  requestAnimationFrame(tick);
  return duration;
}

function HeroVideoBackdrop() {
  const videoRef = useRef(null);
  const loopStartRef = useRef(3);
  const hasEnteredLoopRef = useRef(false);
  const introSeconds = 3;
  const loopSeconds = 5;

  const syncLoopPoint = () => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const lastFiveStart = Math.max(0, video.duration - loopSeconds);
    loopStartRef.current = Math.max(introSeconds, lastFiveStart);
  };

  const enterLoopSegment = () => {
    const video = videoRef.current;
    if (!video) return;
    hasEnteredLoopRef.current = true;
    video.currentTime = loopStartRef.current;
    video.play().catch(() => {});
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;

    if (!hasEnteredLoopRef.current && video.currentTime >= introSeconds) {
      enterLoopSegment();
      return;
    }

    if (hasEnteredLoopRef.current && video.currentTime >= video.duration - 0.08) {
      enterLoopSegment();
    }
  };

  const handleEnded = () => {
    enterLoopSegment();
  };

  return (
    <video
      ref={videoRef}
      className="hero-video-bg"
      autoPlay
      muted
      playsInline
      preload="auto"
      poster="/assets/hero-shrine-keyframe.png"
      aria-hidden="true"
      onLoadedMetadata={syncLoopPoint}
      onDurationChange={syncLoopPoint}
      onTimeUpdate={handleTimeUpdate}
      onEnded={handleEnded}
    >
      <source src="/assets/hero-shrine-generated.mp4?v=20260702c" type="video/mp4" />
    </video>
  );
}

function SectionScene({ scene }) {
  return (
    <div className="section-scene" aria-hidden="true">
      <img className="section-bg-image" src={scene.image} alt="" draggable="false" loading="lazy" decoding="async" />
      <div className="section-bg-shade" />
    </div>
  );
}

export function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("intro");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionTimerRef = useRef(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const root = document.documentElement;
    const sectionIds = navItems.map((item) => item.href.slice(1));
    const revealElements = document.querySelectorAll(".reveal, .content-band");

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("is-visible");
        });
      },
      {
        threshold: 0.16,
        rootMargin: "0px 0px -8% 0px",
      },
    );

    revealElements.forEach((element) => revealObserver.observe(element));

    const revealVisibleElements = () => {
      const viewportHeight = window.innerHeight;
      revealElements.forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.top < viewportHeight * 0.88 && rect.bottom > viewportHeight * 0.08) {
          element.classList.add("is-visible");
        }
      });
    };

    const updateScrollState = () => {
      rafRef.current = 0;

      const progress = Math.min(window.scrollY / 900, 1);
      const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      root.style.setProperty("--scroll-progress", progress.toFixed(3));
      root.style.setProperty("--page-progress", Math.min(window.scrollY / maxScroll, 1).toFixed(3));
      root.style.setProperty("--scroll-y", `${Math.round(window.scrollY)}px`);

      const current = sectionIds.reduce(
        (nearest, id) => {
          const element = document.getElementById(id);
          if (!element) return nearest;
          const offset = Math.abs(element.getBoundingClientRect().top - window.innerHeight * 0.32);
          return offset < nearest.offset ? { id, offset } : nearest;
        },
        { id: "intro", offset: Number.POSITIVE_INFINITY },
      );

      setActiveSection(current.id);
      revealVisibleElements();
    };

    const handleScroll = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(updateScrollState);
    };

    const handlePointerMove = (event) => {
      const x = Math.round((event.clientX / window.innerWidth) * 100);
      const y = Math.round((event.clientY / window.innerHeight) * 100);
      root.style.setProperty("--pointer-x", `${x}%`);
      root.style.setProperty("--pointer-y", `${y}%`);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("scroll", handleScroll, { passive: true });
    updateScrollState();

    const initialHash = window.location.hash;
    if (initialHash && navItems.some((item) => item.href === initialHash)) {
      setActiveSection(initialHash.slice(1));
      window.setTimeout(
        () =>
          scrollToHref(initialHash, {
            duration: 1500,
            onComplete: () => {
              updateScrollState();
              revealVisibleElements();
            },
          }),
        140,
      );
    }

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("scroll", handleScroll);
      revealObserver.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    };
  }, []);

  const closeMenu = () => setMenuOpen(false);

  const handleAnchorClick = (event, href) => {
    event.preventDefault();
    closeMenu();

    const id = href.slice(1);
    if (navItems.some((item) => item.href === href)) setActiveSection(id);

    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    setIsTransitioning(true);

    const finishTransition = () => {
      if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = window.setTimeout(() => setIsTransitioning(false), 420);
    };

    const travelTime = scrollToHref(href, { onComplete: finishTransition });
    transitionTimerRef.current = window.setTimeout(
      () => setIsTransitioning(false),
      Math.max(1200, travelTime + 820),
    );
  };

  return (
    <main className={isTransitioning ? "site-shell is-transitioning" : "site-shell"}>
      <div className="cursor-field" aria-hidden="true" />
      <div className="transition-veil" aria-hidden="true" />
      <div className="grain-layer" aria-hidden="true" />

      <header className="nav-shell" aria-label="主导航">
        <a className="brand-mark" href="#top" onClick={(event) => handleAnchorClick(event, "#top")}>
          <span className="brand-orbit" aria-hidden="true" />
          <span>圣光科技</span>
        </a>

        <button
          className="menu-toggle"
          type="button"
          aria-label={menuOpen ? "关闭导航" : "打开导航"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
        >
          菜单
        </button>

        <nav className={menuOpen ? "nav-links is-open" : "nav-links"}>
          {navItems.map((item) => {
            const id = item.href.slice(1);
            const active = activeSection === id;
            return (
              <a
                className={active ? "is-active" : ""}
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={(event) => handleAnchorClick(event, item.href)}
              >
                {item.label}
              </a>
            );
          })}
          <a href="/forum" onClick={closeMenu}>论坛</a>
        </nav>
      </header>

      <nav className="section-toc" aria-label="页面跟随目录">
        {navItems.map((item) => {
          const id = item.href.slice(1);
          const active = activeSection === id;
          return (
            <a
              className={active ? "is-active" : ""}
              href={item.href}
              key={item.href}
              aria-current={active ? "page" : undefined}
              onClick={(event) => handleAnchorClick(event, item.href)}
            >
              {item.label}
            </a>
          );
        })}
      </nav>

      <section className="hero-section" id="top" aria-labelledby="hero-title">
        <div className="hero-backdrop" aria-hidden="true" />
        <div className="hero-art-wrap" aria-hidden="true">
          <HeroVideoBackdrop />
        </div>

        <div className="hero-content">
          <p className="eyebrow">SACRED COMPUTING AT QUIET SCALE</p>
          <h1 id="hero-title">圣光科技</h1>
          <p className="hero-copy">在秩序与玄秘之间，构建下一代感知系统。</p>
          <div className="hero-actions" aria-label="主要入口">
            <a className="primary-link" href="#intro" onClick={(event) => handleAnchorClick(event, "#intro")}>
              进入光域
            </a>
            <a className="ghost-link" href="#members" onClick={(event) => handleAnchorClick(event, "#members")}>
              查看成员
            </a>
          </div>
        </div>
      </section>

      <section className="intro-band content-band immersive-section align-left" id="intro" aria-labelledby="intro-title">
        <SectionScene scene={sectionScenes.intro} />
        <div className="section-inner">
          <div className="section-copy reveal">
            <div className="section-kicker">简介</div>
            <h2 id="intro-title">圣光国际联邦，始于共同愿景。</h2>
            <p>
              圣光会创立于2017年6月17日。经两次全员代表大会充分商讨与审议，组织正式确认会名为“圣光国际联邦”，简称“圣光会”。目前，圣光会内部成员架构包括2名会长、2名挂名会长、3名副会长及15名会员。自成立以来，圣光会始终以推动人类科技进步为共同愿景，重视前沿技术探索、跨领域协作与未来创新实践，期待在持续的研究、交流与行动中，为更具秩序、更有想象力的科技未来贡献力量。
            </p>
            <div className="signal-grid" aria-label="圣光会信息">
              <span>2017.06.17</span>
              <span>2名会长 / 2名挂名会长 / 3名副会长 / 15名会员</span>
              <span>圣光国际联邦</span>
            </div>
          </div>
        </div>
      </section>

      <section className="members-band content-band immersive-section members-stage" id="members" aria-labelledby="members-title">
        <SectionScene scene={sectionScenes.members} />
        <div className="section-inner members-inner">
          <div className="members-heading reveal">
            <div className="section-kicker">成员</div>
            <h2 id="members-title">核心成员</h2>
            <p>以稳定协作、长期治理与前沿探索为中心，构成圣光会的核心行动层。</p>
          </div>
          <div className="member-roster reveal" aria-label="核心成员名册">
            {members.map((member, index) => (
              <article className={index < 2 ? "member-card is-chair" : "member-card is-deputy"} key={`${member.role}-${member.name}`}>
                <div className="member-topline">
                  <span className="member-role">{member.role}</span>
                  <span className="member-index">{String(index + 1).padStart(2, "0")}</span>
                </div>
                <strong>{member.name}</strong>
                <p>{member.note}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="contact-band content-band immersive-section align-left" id="contact" aria-labelledby="contact-title">
        <SectionScene scene={sectionScenes.contact} />
        <div className="section-inner">
          <div className="section-copy reveal">
            <div className="section-kicker">联系</div>
            <h2 id="contact-title">让光进入系统。</h2>
            <p>如需建立联络，请通过下方邮箱发送信息。信号会被收束、归档，并进入下一轮沟通。</p>
            <a className="contact-link" href="mailto:sggjlb1706@gmail">
              sggjlb1706@gmail
            </a>
          </div>
        </div>
      </section>

      <section className="about-band content-band immersive-section align-right" id="about" aria-labelledby="about-title">
        <SectionScene scene={sectionScenes.about} />
        <div className="section-inner">
          <div className="section-copy reveal">
            <div className="section-kicker">关于</div>
            <h2 id="about-title">安静、精密、昂贵、前卫。</h2>
            <p>我们相信技术不必喧哗。真正强大的系统，应当像暗处的光源一样稳定、克制，并在需要时照亮新的秩序。</p>
            <div className="closing-line">QUIET SYSTEMS / SACRED SIGNALS / FUTURE ORDER</div>
          </div>
        </div>
      </section>
    </main>
  );
}
