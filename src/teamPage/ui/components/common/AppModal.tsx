import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

/*
 * 公共弹窗外壳 AppModal（S4 弹窗统一）。
 *
 * 它是 ui/dialog 原语之上的一层**组合壳**，不新造原语、不改任何 Radix
 * 行为参数（modal / dismissable / onEscapeKeyDown 等一律不碰）。收口的是
 * 10 个弹窗里重复了 5 遍的四件事：
 *   1. 宽度令牌——现状 10 档宽度 + 32/42/48 三套沟槽并存，这里收敛成 6 档
 *      + 统一 48px 沟槽；
 *   2. 高度策略——现状每处各写各的 max-h，外部模型弹窗甚至没有上限；
 *      这里只有 auto（封顶 + 整壳滚动）与 fixed（定高 + 内容行滚动）两种；
 *   3. 头部结构——标题 + 可选说明 + 右侧动作钮（新建 / 临时添加等）+ 自绘 ×；
 *   4. 关闭钮与首焦——现状 8 处 onOpenAutoFocus + getElementById 的等价改写。
 *
 * S5 / T1 又补了两件 S4 没做、而现存弹窗里确实各不相同的两件事（都有既有行为
 * 钉死，不是过度设计）：
 *   5. footer 槽——钉底行（群模板的「确认创建」）。**条件渲染**：没给 footer
 *      就不渲染节点，否则正文行的定位（content 的最后一个子元素）会集体误红；
 *   6. closeOn——背板点击语义。现存两个弹窗恰好相反：全部笔记背板点击关、
 *      群模板背板点击不关（只认 × 与 Escape）。
 *
 * 契约纪律：id / aria 一律由调用方透传（#people-library-modal、
 * #close-temporary-person 等 E2E 钩子逐字保留）；关闭语义维持现状——
 * 所有弹窗都是「onOpenChange(false) 才走 close」，Escape 与背板点击因此
 * 天然可用，这里包装一层不得改变该语义（true 分支不做事）。
 *
 * 样式上每个覆盖类都从 className prop 走 twMerge（cn = twMerge，同组后者
 * 胜），不靠 Tailwind 输出顺序取胜：p-0 / gap-0 / rounded-lg / bg-popover /
 * max-w-none 逐条抵掉原语基类的 p-6 / gap-4 / bg-background /
 * max-w-[calc(100%-2rem)] sm:max-w-lg。
 */

export type AppModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'

export interface AppModalProps {
  open: boolean
  onOpenChange(open: boolean): void
  size?: AppModalSize
  height?: 'auto' | 'fixed'
  title: React.ReactNode
  /** aria-labelledby + 脚本钩子（如 #people-library-title）。 */
  titleId: string
  description?: React.ReactNode
  /** 只有给了 description 时才会用到。 */
  descriptionId?: string
  /** 「新建」/「临时添加」等动作钮，排在自绘 × 左侧。 */
  headerActions?: React.ReactNode
  /** 自绘 × 的 id（E2E 钩子，如 #close-temporary-person）。 */
  closeId: string
  /** × 的 aria-label（已译好的文案）。 */
  closeLabel: string
  /** 自绘 × 与 onOpenChange(false) 的同一出口。 */
  onClose(): void
  /** 收敛 8 处 onOpenAutoFocus + getElementById(...).focus() 的等价改写。 */
  initialFocusId?: string
  /** 弹窗内容节点 id（如 #people-library-modal）。 */
  contentId?: string
  contentClassName?: string
  bodyClassName?: string
  /**
   * 钉底的页脚行（如群模板的「确认创建」钮）。
   * ⚠️ 条件渲染：没给 footer 时**不渲染任何节点**——正文行是按 content 的
   * 最后一个子元素定位的（people/* 的 5 处用例等），空节点会让它们同时误红。
   */
  footer?: React.ReactNode
  /** 给 footer 行加布局类（如 'flex justify-end'）；壳本身不焊死对齐方式。 */
  footerClassName?: string
  /**
   * 背板点击语义。'default' 维持 Radix 默认（背板点击关）；
   * 'escape-only' 只认 × 与 Escape（群模板现状逐字对译）。
   * 两种模式下 × 与 Escape 都必须仍能关闭。
   */
  closeOn?: 'default' | 'escape-only'
  children: React.ReactNode
}

const SIZE_CLASS: Record<AppModalSize, string> = {
  // 沟槽统一 48px（现状 32/42/48 三套并存）；值口径 520/640/720/820/1160/1500
  // 覆盖现存 10 档里的 6 个，S5/S6 迁移时按最近档收敛。
  sm: 'w-[min(520px,calc(100vw-48px))]',
  md: 'w-[min(640px,calc(100vw-48px))]',
  lg: 'w-[min(720px,calc(100vw-48px))]',
  xl: 'w-[min(820px,calc(100vw-48px))]',
  '2xl': 'w-[min(1160px,calc(100vw-48px))]',
  full: 'w-[min(1500px,calc(100vw-48px))]',
}

const HEIGHT_CLASS: Record<'auto' | 'fixed', string> = {
  // auto：整壳封顶 + 整壳滚动（外部模型弹窗现状无上限，迁过来按 auto 补上）
  auto: 'max-h-[min(760px,calc(100vh-48px))] overflow-auto',
  // fixed：定高 + 内容行自己滚动（列表类弹窗保持「头 + 工具行不动、列表滚」）
  fixed: 'h-[min(760px,calc(100vh-48px))] overflow-hidden',
}

/** DialogContent 的 onOpenAutoFocus 事件类型（Radix FocusScope 的挂载聚焦事件）。 */
type OpenAutoFocusEvent = Parameters<
  NonNullable<React.ComponentProps<typeof DialogContent>['onOpenAutoFocus']>
>[0]

/** DialogContent 的 onInteractOutside 事件类型（Radix DismissableLayer 的外点交互事件）。 */
type InteractOutsideEvent = Parameters<
  NonNullable<React.ComponentProps<typeof DialogContent>['onInteractOutside']>
>[0]

export function AppModal({
  open,
  onOpenChange,
  size = 'md',
  height = 'auto',
  title,
  titleId,
  description,
  descriptionId,
  headerActions,
  closeId,
  closeLabel,
  onClose,
  initialFocusId,
  contentId,
  contentClassName,
  bodyClassName,
  footer,
  footerClassName,
  closeOn = 'default',
  children,
}: AppModalProps) {
  // 关闭有两条来源：Radix（Escape / 背板点击 → onOpenChange(false)）与自绘 ×
  // （onClick）。现状 10 个弹窗的 onOpenChange 都是「false 才走 close」，因此
  // false 一律只收敛到 onClose 这一个出口——这层包装不得改变既有语义（否则
  // Escape 与背板点击就不生效了）。
  // true 分支壳内不会出现（AppModal 不渲染 Trigger，弹窗不由壳自开）；真收到就
  // 原样交还调用方，既不吞状态变更，也让 onOpenChange 这个必填 prop 不是死参数。
  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true)
      return
    }
    onClose()
  }

  // 只在给了 initialFocusId 时才接管首焦：
  // preventDefault 挂掉 Radix 的默认聚焦，再手动聚焦目标（Radix 挂载内容
  // 晚于 open 翻转，放进焦点调度内才不会被内容挂载聚焦覆盖）。
  // preventScroll：聚焦本身照旧，但别让浏览器在新出现的滚动容器里做
  // scroll-into-view——height="auto" 的 max-h + overflow-auto 会把整壳滚到底
  // （头部与列表一起滚出视野，模型 ≥7 个时必现）。迁移前没有这个容器，打开
  // 时看到的就是顶部，preventScroll 把打开位置恢复到一致。
  const handleOpenAutoFocus = initialFocusId
    ? (event: OpenAutoFocusEvent) => {
        event.preventDefault()
        document.getElementById(initialFocusId)?.focus({ preventScroll: true })
      }
    : undefined

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        id={contentId}
        aria-labelledby={titleId}
        // 有 description 才传 aria-describedby：Radix 无 description 时不该有悬空引用。
        {...(description && descriptionId ? { 'aria-describedby': descriptionId } : {})}
        // 官方浮角钮（absolute top-4 right-4）与「头部带动作钮」的现行布局冲突，
        // 且 #close-* id 契约必须保留 → 一律自绘，见下方头部。
        showCloseButton={false}
        className={cn(
          'flex flex-col gap-0 p-0 rounded-lg bg-popover',
          'max-w-none sm:max-w-none',
          SIZE_CLASS[size],
          HEIGHT_CLASS[height],
          // grid 行数按有无 footer 决定：无 footer 时保持两行（不许无条件写三行，
          // 否则正文行会被挤进一个多余的 0 高轨）。height="auto" 下是 flex 列，
          // footer 只是最后一行，不需要 grid。
          height === 'fixed'
            ? footer
              ? 'grid grid-rows-[auto_minmax(0,1fr)_auto]'
              : 'grid grid-rows-[auto_minmax(0,1fr)]'
            : '',
          contentClassName,
        )}
        onOpenAutoFocus={handleOpenAutoFocus}
        // 'escape-only' 时挂掉 outside 交互。⚠️ 真正的**行为增量只有背板 pointerdown**：
        // 焦点外移在本壳（modal 弹窗）里早已被 Radix 自己挡掉——DialogContentModal 内置
        // onFocusOutside: event => event.preventDefault()，所以焦点路径本来就到不了 onDismiss。
        // 机制：DismissableLayer 在 onInteractOutside 之后看 event.defaultPrevented 决定是否
        // onDismiss，因此 preventDefault 即可——与群模板迁移前的写法逐字一致。
        // 'default' 时**不传**该 prop，维持 Radix 默认（背板点击关）。
        {...(closeOn === 'escape-only'
          ? { onInteractOutside: (event: InteractOutsideEvent) => event.preventDefault() }
          : {})}
      >
        <DialogHeader className="flex-row items-start justify-between gap-3 border-b border-border px-6 py-4 text-left">
          <div className="min-w-0">
            <DialogTitle id={titleId} className="truncate">{title}</DialogTitle>
            {description ? (
              <DialogDescription
                // 没给 descriptionId 时不传 id，交给 Radix 自动生成（避免显式
                // undefined 把 Radix 的自动 id 覆盖掉，留下悬空的 aria 引用）。
                {...(descriptionId ? { id: descriptionId } : {})}
                className="tiny mt-1 text-xs text-muted-foreground"
              >
                {description}
              </DialogDescription>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
            <Button id={closeId} variant="ghost" size="icon-sm" type="button" aria-label={closeLabel} onClick={onClose}>
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </DialogHeader>
        {/* fixed 模式下内容行自带滚动（min-h-0 允许在 grid 行里收缩） */}
        <div
          data-slot="modal-body"
          className={cn('min-h-0', height === 'fixed' ? 'overflow-auto' : '', bodyClassName)}
        >
          {children}
        </div>
        {/* 钉底行：条件渲染，没给 footer 时一个节点都不多（正文行的定位靠得住） */}
        {footer ? (
          <div data-slot="modal-footer" className={cn('border-t border-border px-6 py-4', footerClassName)}>
            {footer}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
