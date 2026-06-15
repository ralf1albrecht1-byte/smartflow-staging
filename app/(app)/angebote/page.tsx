"use client";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  FileCheck,
  Plus,
  Download,
  Trash2,
  Loader2,
  Undo2,
  AlertTriangle,
  Volume2,
  ImageIcon,
  FileText,
  MoreVertical,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CalendarDays,
  MessageCircle,
  MapPin,
  Info,
  Pencil,
  Phone,
  X,
} from "lucide-react";
import { sendPdfToBusinessWhatsApp } from "@/lib/whatsapp-share";
import { TouchImageViewer } from "@/components/touch-image-viewer";
import {
  CommunicationBlock,
  CommunicationChips,
  buildMergedContactReviewEntries,
  resolveCommunicationData,
  stripForwardedMessage,
  type CommunicationData,
} from "@/components/communication-block";
import { MergedContactReviewChip } from "@/components/merged-contact-review-chip";
import { ServiceCombobox, ServiceOption } from "@/components/service-combobox";
import { autoFillCustomerFromNotes } from "@/lib/extract-from-notes";
import {
  mergeCustomerIntoForm,
  isFallbackCustomerName,
} from "@/lib/customer-form";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  DuplicateCheckPanel,
  type DuplicateMatch,
} from "@/components/customer-duplicate-check";
import { MwStControl } from "@/components/mwst-control";
import { formatCurrency } from "@/lib/currency";
import { splitSpecialNotes } from "@/lib/special-notes-utils";
import { fetchAllJSON } from "@/lib/fetch-utils";
import { LoadErrorFallback } from "@/components/load-error-fallback";
import { OFFER_STATUS_STYLES, getStatusStyle } from "@/lib/status-colors";
import { useDialogBackGuard } from "@/lib/use-dialog-back-guard";
import {
  isCustomerDataIncomplete,
  isRequiredCustomerFieldMissing,
} from "@/lib/customer-links";
import { PlzOrtInput } from "@/components/plz-ort-input";
import { CustomerSearchCombobox } from "@/components/customer-search-combobox";
import { MissingCustomerDataBadge } from "@/components/missing-customer-data-badge";

const SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227 = "smartflow:close-card-popovers-v17-90l227";

const OFFER_DANGEROUS_DOG_ICON_DATA_URI =
  "data:image/webp;base64,UklGRiweAABXRUJQVlA4ICAeAADwpgCdASosAWgBPp1Kn0qlpKMiJdLbsLATiWVu4W/Q8F/dkF9BJLTP91/ceINPNbF/4/rC3BOgu9WP6LnTSfuXhl/+m86vk1lsrx8L9CvPf2q8AvI7tGgCfX/z9/xfPH+N/1OuS0BP5//pfWY/4fMV9jcDExwQ5tnhzbPDm2eHNs8ObZ4c2zw5tnhzbPDm2cFcBG2+yyP+Snwqa/kf901I10cNJub6Tc30lRFDqfd4Dsi+CuYkxP3hHyiQGCdK9pDNsZlvQfAojDceR0PMjoeMYDrYZ4SpkxZdBgbHhs1W/ZNDXeSozJ0YaGxMwTiwvbHawAdDzI6HE35XJqcu9HdpDjzGpZvMuaE4oFRqv+HOT1ZECIItJUrYVycWiHsuOlu9Kvq+rEJDH8Ll6yxBqovM5Cthgh9f1ApTceX+WVfPhdlfB5WA+aUY4lfRbtN4cbR5d1loQ+X8vlbYTjoF7GCXS3EjXtuWpzm5HHWt1C4dCRAfoxRwd7pATUQ2lpc+sC4fgMNEN92R8hc3V/bQ//XXxulNN/gbYNEmBDL1092B++TLz9Cq6hkpqU4rxhrpIrkp9QxFv0rNuS9f49dP9WbIQbxcvdtle3f0e25sGMOIZZKROfHaACVSngFIGcK7iOjaSXZL6ZjWnAn0TG14us20S132hZdzQnesX0809RU0MgCv0GdI77tbAf5TNxD7oPQUpOyXYnXhmFNRqirrMZwmb7QPJ9Ijyx0MFcWs6AOCSKHTDxBqvQjO5upKKjlxug5LwsMAxK48rTxjyprgohv8Bm9xyu9HPEW79TIlYUfetLJ9gxL/kVxyyxVUQRZwHTF7sBpfZybcC5pjTxFfwRuFRcRNzMIZBEf5Wr+iC6HNzXQQbPRlywCxUXaxOBE5yrPsfVFkWI0fxDICeIoL1vfQ22v1h3oPwzfIuBGrPwG9QGxJw0Hlibihc1Ke6b6Pl6vAziITvIFbu2PdWsEJDAsf2Ma2U2eocLsjGrwu+cqz6uqL7Xg0qfgHUe9xvSaYTVMU9iKW6MFbGyTltjgzr8a38bOkM9I5lPjd3X8h8jlbUAJD8Gkgb5UBf/qgtK4TpuLwXCa4OjWRfRYpSe5B0A1/OgfcSO1FbTP9U3U36HHTVxVYnXEtAxuqrTTRfJvaI9hOwuUUKQWZJcZ2C5ebAzNkXWXHibL9xAdkRGbJFTVceMQV5eznwBSqQ8pBbnRjhpb2yfk3OKIoxpwmp/tuIndp5cgWTqd+DArhw98D/j7/diP+0S+YYzmC58ejOfxA1en/wbPBI84QgcM4zt0D/T3nXaq4djMSmxS/8tbzftPrIVC8ZvWC+CaWV3GuqSpmk4WSO4P06R87Uaq4C/cpXrHay2rWDoiuRNOM/yJyFFu8LHDvqmE/sxXUVC5do97Ke6Uv8VZaTUpCVK5MaNpIWFxorw9xJEwi+RfiG29YWbPJVHYxpHQqAeYdE5xe6lHwOq1oAa5/9FVgI2kRTitg6s8mxv7dMUl9gX3yfA3K+PKaF+8QXMelkxaG29KUckgi29CIpVub0k/JPSSIXE6Z0dgzziYMohOdmoOVHFolHb3EEQhyqXy3HFoGOTqzxpeZztzyqWI1us2N4D/9PKpos4TATavbu9MDrMQvn2FbVuTHhJLa7AwmHextdb0oAuk0D6+WVHq9Jq3dCOJchLzbTdS/WrScGGA18WIZTgT/Yu58WdhtXifuX0Qzhv6gP8LbMJU7llYvxCFJJmUT7LZX/hGXEmeVz7lFRp0ri2zw5tnhzbPDm2eHNs8ObZ4c2zw5tVAA/v6t0AAAAAH9H5ezPVPcP+tMyM+E0pMB8y+Q+ZjBAix5aWt8H5doLslZRp4UQTjpuxnNaVeqK0Uc9ePB2EIKlKej0FAtPO9E0zGKqIGQhD68p+MnZxbD+/1GzxaAeqe4AhTrAjrGS/e5lYiO5cokDm/KH0Gu+ghdyqOk/kIVrHTDjt/KPV3VizDbSowOGlonNUm0qkyLsguOUhmY5cQK7LnO5jdoYdngxVImzXpRawRrnuchH4KVy5L/dDX00LbvBA4id79i5nsEYUb/ewEB8LSBoZVGXJD9ntCjdKpr+RfCTEYEyFeUV+URK6CWvuGpkqy8AgQG9i563DsbnDGpYP7+c5+jrKBkeo8kmBxgOZGpUUTX5/NPBPzMqbYjCQAwlnsQS7JLDplCXzk3OXyKSQgn9s7aEMcFmJW0E6umaczSbocMqoPweMQ8u1DOhStPZnL87BXdUBr12KFPQHqzYolRrU4MEbhgBTCo175dp1IREG78LV/oMv4clb41iicUO1u0RZ2XIamoNfaPuuk32aDaLoM+ogRe0gi2aZEbOH2JPoDM+zuFpVl1It3JYmOkeyKauzZFakY3TVdwx97/yJdSHXhEvIYHOjgahQLVrZmguv7QH7Yv5vkRd399vkdL5ZHDxtEBiii39oZjb49Bn83L8DA9Orn9cupwLlH4MK7nBzasCIAWYRSNLX3BOyPm0cZd5qgqEoGCu8ivKvakxq9HrXakKV+4LrhkiNxIsWFs6X1H+Ya4MaiajsPIhxI2KfcIBPcLKtjDJG8glYcnoWk5yUSD3bYuL5R58IJPxnii4k06ROSR6EucnWXZTZVAkkk1Dd75caM7dEvvU/uwlwHLjTAImUkLi09HSaBaV1IolrJwEosYvPTpVtA2nzP5R6fmTilv4YDd8qYfQzzSNdTEihd6FRffFLHuQsvA3TUzPTVcGZGmJIaGgH+KH13NrkYjcWLl3RY3DK4VKahvR5oNzUVoFUSGPNIW13xjhyL/av4vDsuE75pKCG8OSX5pQWQnPruyCeYepQX5RGS2lAwF4ujWLIfw6mhgextWrVh8GIQ3qenBt7djV8J4ZQFwKlsrJTXm7hiFcyWsFyuFvLNyWIjZclzpcBl35QQU+CeXSCLhD7J+jTSEwG0n2WkUTnfpBXpwgV8j1jmMwevrtKYiwiulfYs4VIiQ8Sx6qySFTliCcy/5jdcdvgD9JWwIXqW6WlhXnxVmuwHzkfWlcXOcX0BqlnXDq+pxQlSEqe6x0WfgPNUNke4xM0fOZ5V071JjlNZdlhUT0QJmrozdVVNIKb70GywCzICbFdhOpxiky/+wY6TIDRl87UboUwt83xlqZo4i4a81DYaQewJCbr9q0fdytJ29+oeuweYwnXL/uCImitYcuL88JZ6P52+/QcO/wi3ZH/R2cKbpqJs/kycoTUXfS9bpXBJUGytlS5XrdtCoEyTAzzGoF5F4N1833f18eu78kj3g/g6sb7n0knyk6H4FHxLUa9XuJXAQGzHJPDLXPZo3E+/N9mLQtDBw1iTUfA5K/xv/c5rgonYusMyl/4dLCZKXLTK0yFppKFydX/HAotrMQ7Of50UPzRvwHyN/Li5pVhZo+N6m29qafhO69pavWJUwUMb4aglZeCvAHOEQPAM8UgVMEgUStOdrTEtnWztpSbyfrM554uYx5lQPic223DnY7e+RuF6WbJvjTDNZDl5/LlGfdyBHqkAvCnXZrBTLwuWsYVJGU9zJVX0swUD+UpZsvW72Ena5g5nhTXzDZZoA1/rFLBt8XWbh5p00SlKFQAA4aa5NlASyAq61siTlfSRIRSamEyinWLkPswfObrVOYNUYfXelZ1cItTax8q0gIHcvW3y+INQ0kPyEZIgbgs/SRT4d3X1uy3sVJdFE4+dCAouwRvkVRzMCB3L1U/p6Pe7I84rds+5nSIMNTiVRNJk890GwX/bndjryuKvIn+5eJWtPbCnAS5YezJ8mEd0ErVzZM2LMg7RmU160DGltrUXVJgQYOY4oSa+AWs5+eUD1xNSJqtqWtQKbNKxGX/7UsETSz/2g6Bb7p0KEyPdOWmYeAZo6swZX3uVJBN+h9DIj+GV0ksmDh56bPXfT8iDOBqqmQ7v4WQm1Y+Pn5f8q7d/09YYMfjtdxwmN3/MrUFNWDgyIB2eB3mlpHK2VVQr/y3bryVMds3KMrPu1rTmB56ryxjIy6SQLi5SHw5KGwh/3WaP5apWmarCtDVJsH3yuPxOaMqCTTq3mb1KdPYAjM0q9XB1fQso/8i9+GtIRlMHiduUbVMahpxongCgKAmtENt6GzVDS/kKIwVk8XPJfbk+JrSujPTndw12rl2/nudQd7l57irv4X7x5/4+w8IalbcJ3H8EQDEKDn2aUqhN5kC9vISoZ4CqPzcU2bZ3qsEG/1JW44B8aFpb2sJ8MeI8jTq2/Z8q9I8qM7GX652L71s1p85s9HCY9URls4ZYVgC6t9sAhgogotYDuX77gCk8jJmh5Y/iirZ0JD9YZXCK74sSAuxIBdeIF3Thqw1KR4MFbGjwBLOMfsOuDjj4Zlw3rlWdEs1brrCzMiFjf8fabUzVGvR0bNUrVMWua8rqHunxN8l1PNIsOOjr9zQXqcW0sO4fibUXbv9X4ZbqOHiVoPNnY/hzHSJvnmUQss+OcObibiFCLlwolbkyO1O7pAoVgyVoWhKbwii+9jzlcnBH4v4mB24AVq7LzGEoeDQAOmKWMFRLU99fRyG3ebCIDPbeSbQYWrUYYofgvOtAnkJObHXls4Ba7Yc2xNdO7/XjffxrUBFy8GJYgM87CJ5OCZx02wtJQ8kp3MUCsjYWMA0c/OKMKW62+FO9spwuBs5mN8EizkOnrAEV5qJ+JwXuk9bKFYkNLvG5eZqniXGDRSDmp53O6icFDcD36nBRUW1OqIhTshYHJ0qpkb08QgKSZoJ6zX2gmt54mAQLWvCW5KtON8fp/5kk/MkzoCUwYbWUfceoFAiVFA25AMGiSfAAzvKg5LtUP2PJWBMiaYj8+FHlcEN3SGGf540DB8SZAMfvcDT686D8KivqS1mB0vCrr1DoT6fHt40rYDEQYi4Xvkyh205EJjF1x065CpatV5h2j4gWt3j/uoXZIJ42EikIgEzEk5kLjE9J9SEGBlzV1ErQTYBIWkvzxMNUmWy4uxSYXx8QaXnbCSX6N3rak/YON/NwO19kmH2tnf4T+Y1ZWZWvrRgcKHJKqHO4w1nM8XJvsuXDdshtxmI8LHV3zr6/8MEKc+ANpFWbDoAfbRI02pwnD4sYtrPzlQeJbPfGrFBIPqksA7U2FjqdYBaijrGIb3d8TUFDjS4xx+64d54Vkcj3xx9HyTzShjmd7I2qJD4QvgBCR3SWd1NyMTWi8uKGtpqN5ndNzld1aztpieT+twh/rrg2IGenCVsWXJHUIE+tl29RMxE3PbaH3mwMPc2pt5AAikE37pW56FqjPhIrArqEv73i4aCVDKzLmib9Yv7ho8kVSEDjD1/1m0iLl0eHqWk8xXziwaiZE5EckluxCSkps6vtdmweccPoYRA6hA7KHuqIu8YcqOBaw/j6QyoaB1Al0ALfbxTtlkH4lAqtA8OlfqD4XHONaL3uynUbCmku0shTHceuYNXNxdJnnNlgYudXrNyOgeP9WcsGwTye9pbWzxvxjC5dSM75HBpN4/5ejysBXJIVsC4v1aghfZY6X09awNVbMIDcgvlEVPEsFztSB3R8HqlYwTXw3xqnY9Me4HWDGmgAYfCf1vZO58D2yW6hibYiS2tc03vMZLl1AdfCHDZBtKBzr764ykPPWOBDGkx2ANSW4TuCLt16Xdaqi6idIIWM4MFS5Z2u2C9yWirbGB0FU0X7MvQcajl+xOSwSXlMclpJR6Aq1EcrF56UO3gjusV45UOF9rF6fbELpxuFxQ2KYWp2n1MuHD9M37thHlT4mVe0CkIh2QkCrtSR4cepL/2XTEErZpVq6D1H72Q+Cu8l5bKRUwRlgs8HgroC0O++nnZYGjsL2YZ1fJS9GLrW07iYyPd36l4L5Karuar8wjewMtRb9BoT3tqztAtgrkU8yxj4BbZ7vQ9r5sPYnxXjouvb8XItOE9c/7SFCrK7kXbPVf8P7bSvmbTIeRzpVa5hBhaiRFzrMJCw55eNFDQ/76DGZne8WPzveZO8XdoU6E+4P9BELZ0W2OqPwLyHUJ4wUwYF9gE0ZBfp4zHCSTHNX5UD4/O836NT6Ek4CYo7k1V+UoikEC4tF371Z5hhKpRFKTDs7ObT+ibnEQiwA6BFRBiTF563QSVtuJSROP2gDQWkeb7yTxhAM6n7WNiEtIPI/mqQ+Gnz55FUbzDw5eY/65k0hqh/W8XYMx5Q4Zow7gVgik2U62yzA/sewNWdV7zRzlXLndUEtn3nux7zX7aRwYayxvMeKzwWnyJaF3KYNYHMbyhg3J6YOMebR7nzxAzS/bzNJZiLW9gNUi8kUIlYIPaR71cGt9XuSoLPcvq89BNuHpvCSn2dejnR0OCFI1mX4k4SU2+Pywj/oZ7M6JsPypDuzjSrXXfsMin9Aq18GVS+EVIWauHoan+7M7op/krGaJEwmD2P6BfEUpjvoG/6q157jpl/NbBG/ibS9p8cOuxCsfJ2TA1ZpzhHft8gmcLgfF7N0vKgtHssJD4eE+Di9XisFoWtucGxSgpqvr6m1tdF7+HdFdSC8kjtBDpuJdv43dZc8vvkutzpSjbGD2QMQB//9+1/e1Ze2BSs6jdWFU7HsTodMNaMAReVRVK8ZZMhSGR9wXqU9lIXlI2u9D+tTX4/epay8jUDPSsEwqQf5JJXDd2WtPSQhplHUOXyqpZnYXL1UfTuiz0Nj4vKlUGI6x1KDZoS84eaFMQ/JZinbU6okvXsmKMh7wm6KZYStBnUDdPztycErRbaCjOSzOLNRW0XH0zDOaTf3k1f5GruFp1zZgipL+JfQa3R8vrHtrL71kVfPCNWbSUaXpXcpt8ntr1j4SBR1EBK/e32PMj48Y54lEBYNcKCYrb2m3+VRaV40oW+yiS0dEUXASMcfQLOiLf2BUUA5er/UtV92d172gxKuEBTFs7fDbmJ2MiQUWniTBD1rwrnrycNQkXh5prtfiNNmox6fNBarv3xJ4zySlPalf6QWOIPcDhz8H7Oj07XxrBXYrad0zd/8s77OdijmL9ixEHzOj14TE0jTVdqjBCYA1GoziGndq3xG0rjfUcpcrf9tE6ia0w1cRnGyDGsGlyy7DofAW+G1ob+l5e1r6aZYX7wV2M1l3AZmRI1r5SjC1oWno7QYTRm8s677n/Vfp7c9ADVux3VDs6zP6Zz47bdC0UUvmvgGo7PJUGfe5zFYEsuz3PRl0kBuLzfmGsy46bmjQENj9JrEdpUxzEVyzCA0myKnxmvymrghyK6/Z6z2mm3KNbRQ33Qfd74YAbB5hy855m4ZqMJSmlsySpjdUDXICXL8Lz15HFSIKNtf1h24oAl1Zdf346HnkM2XtWa+BWcWbXKBaoilBtK64oOImBIb6IvgDSyLo8KkAv1CFPvBVQ1pHYpx3qp/Y/xJA/ZA4kV5DU97Zm7d9FrzqkdIuKae5hki+vdxlnra6Ow1vV44kWC1FTY/tMVR//sq4m5+zEf6KPaRET4N/1yDeBHIqm4X+fS1nc9Aa480ZcyFUG2m7C2VQGpvZlnjE+QzHUYaqKDTRib2L8ebfir8dkeiBccmW5objlrlxG9n5jyfMd37dwEuHtRm64Km2q+HnczJdHpn7HhHUyr3P8hhxL5jIZ3iJ1Pt+Qnz70aUKUS+zQd0fdiRAU15YJodItjd79CMHtbDCL6nSzSGpxdtlaeS1OKmG9cQ61Y3VwFhAIh3MIgXXj9b+hVGutRALeQ1xzqv6lC/u/K16aiV7GrlO1RP5Uph6y90Cd964ovXFiSS0jEP7QWLBjd5UIMp8P/J58ptEYe5pOp9L9zkdAmp18Zvvz6jxUqRKjuWekK6dgQkmR4C8yE4vi18qEynZ3sTTW3darai1QMFL9uhZzC85hsmn1V/wO4ToKhTAS+y00sIrLStxX4fn6a+YQcCKfGuX/L1+8FQeH7bcx5xPaan5OBMLOOxU1B0DIpEPkJ+tASd+dot8G+xTa9RPV0tKeDx8ir8VJwu2a3mGT2Dynhlj/CfHHGCT3ecDtroGigz+O9d2Gl1meFbr1QKk1H1HdsxLw++DSjPTYAMd4IvHTdSH4thOdtTjZ46B/Joj+dlxiUU1WJ/SLg3tUgvwMuilxIZ4vIWsE2yh33zG9njUQ8Gb7YNxDZseji54tItR9Rwk95wJ+y8MhgVu7CyRYlHZ7o5oK7zIQ56ODD+7npMqhzEtv3vE57gzcDzRDXA26qp+/FfnLoJBaI3CWfKeTzPEUxRm5dEM7fOEbi2qQw8x5ahCjqQ/rbhgAYI3YYYMkBT4EZNJzgeg7hWgDCYLuhPX+mXaWXyJgge0nRAD1UdDTg2cObgk0xh9slsFw0ovuairHdosmzJSsiWHS3lBrYAb8VYwFX37yNXT68SKavm37r66//jovmmc8TbKr5aTVxJS3RmaQim2I6amFp7WN0DVLg2jYbKqzg+PnvrCOW8MSCIcbjaqFI0hlfYl9V08F8FHo/jNx8uKyrsuc8RQ9grs7Q+OqHQYexVbuv+/W7/HYylm/cHldf7c0vWY6jqBkqPBQCV8Y0WHAO0uursJdxQFRGhQxrbYJareyvHAGj9UxSqZqeOPAgeaxehbuySPD32dRopzBhcvd3sQDJ7TOcQHeK8ABiTqdJkwg+5jaZA4TFSyngmoDxPS+yjt+/tEJrvfNOt/3Vobrbl915KHPLBznsr0m20lGzfq2RIh6tEX5V8qeBc0lHkmH9F+IBbN9Eyg3GEAOJNp5P9x+BRolldC6sPMdax8uQIwLGCjrWQ04Odv5ujDCIqjcUVbnyfvQ7QurpiNyG55rLC4eGkQrNGCpRlGcIjtv0+6ufEWxx2BORwsdj5T0RigXLBWA109i3+XvfUDUBWL7Ef1PscrG5Hm1+eJKysptXokIpGW+FHLejxKHYLgj1C6Ru7TLEiPEaiPKZgBjwN+tIQjOF2/cwJDOwqn5UDEleeGeAbMpqGcCrMRgZS6p12FQ26xWALYX84oIDDuSqmO+1sbUHGMZPe+IF3cJbTfutCWFw0haGhBbqKDfjxNo1ToIrWAEJOZpQdcjvmvSr73OejKF1m9e7tZCJM2MS488ATrzgDi3rORtkxLlVVZP0Lgt84649+dbZ/8PLYzBnu0VnAUslX73KU9P34Gad8OiRuX8LJVjB8bEJKE3EKOS3mCpW9cBLkJGNLqLiC34OIJzhDSDcC0A13OHBWKNsyh/X7j+j5sw3csju+qP1vH98LRCFamkSD0DnzWKCryA0R9ZKniM+UPbrV6ec+XZm/oLNkFnCeYmybGFCmP/G/chRENsEyftWWF21Ewg/6PfiSJtSyuWqatgY2PHGixPPO2Rz4EN+bfRrx2lylXlnbIYeJhdl/3i6uiX76uTx9r5e/HaHzL5M2xRd/yn9uzzMHEeBt49Y2AXCq09xnSTHnOQwlxI+ftguc3J9UMRFl/KJMwwNu74KExUljOri6PToEJTZJbWrRsYs5Rs2xspYem0wn2hBPNd0+WIHl+mjMMaxOw49cCTwlXAVWZWDHhJPLLA3E8rXWLx35fpt2GxR6E4BG9hkMXEVFp09fQkmYUegDczXv/eaqSPa7bBT2wWWPDTM5r3lak6fbanyEZwe8O60QF2d9tkiXSDv9rObg9xdNmv9Jxam/Vt6E+z4fA9S0nZJ9eRhn8ofs3CzzrZsbiVDN1ldyC6V1T0NT9TcgIttK521ZL6yeuMOYh6zrJ4A2D96TP0kVQ8mFv8NKqRbFib0qYpZTzRSVukUL9tdF8WVLClRu0wmCFxWmtHMB132PveeyegVoYL8yYRXguo56+oZpuPZJAms+EAMALPQKNC/O6y2nPEIpO10tOmm2V9eGWBIhjwGfb1dk2MoUs/ZIjwLEswn2Zg96k7Rm1CCGqPoP4nU7XC66oD+YUfze9ZdA+zG+YXqfqDlnUimdTw9sQTvB6nFqHjSLBlq7+pfEWpMcCf2YYyL7yO6FlR+3j2+k/Q6m/ZzJ1r3ZkkRvl/02sAKxyMdWCHptrGa/uoS4fpu/SzsRPgQDRdGGPeddcVpOGAH4JnVfwfMEXdTnfFYQpIuUtf+FUNRAqRQnBLDrHFVkgapPVWis3WbtvShuhfDwd8ykxYQDC5sDPl8RiGI6Vy9c8ccP+FT9qTiCSD7BAkgyQExiauC/Wm2Apff3708YvVo2zim6J8sNKAu6C2l1V6RdzWAwejkS8R2ozTIaOWZO+ZOhTS45XAa0RVlLzeffBgKjdFs1Skcxj3uNRPiYPoki5WlurXsWXS4/7gKuZgfz8cg4QPn1xjyrD1GD8maGSho1aXL9I08EBLYANMHh/JAAAAAAAAAAAA==";

function OfferDangerousDogIcon({
  className = "h-5 w-5",
}: {
  className?: string;
}) {
  return (
    <span
      className={`${className} inline-block bg-center bg-contain bg-no-repeat align-middle`}
      style={{ backgroundImage: `url(${OFFER_DANGEROUS_DOG_ICON_DATA_URI})` }}
      aria-hidden="true"
    />
  );
}

interface OfferItem {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
  sourceOrderId?: string | null;
}
interface OfferExecutionSite {
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
  sourceOrderId?: string | null;
}

interface Offer {
  id: string;
  offerNumber: string;
  customerId: string;
  customer?: any;
  items: any[];
  orders?: {
    id: string;
    originOrderIds?: string[] | null;
    reviewReasons?: string[] | null;
    createdAt?: string | null;
    date?: string | null;
    description?: string | null;
    notes?: string | null;
    specialNotes?: string | null;
    needsReview?: boolean;
    hinweisLevel?: string;
    mediaUrl?: string | null;
    mediaType?: string | null;
    imageUrls?: string[];
    thumbnailUrls?: string[];
    audioTranscript?: string | null;
    audioDurationSec?: number | null;
    audioTranscriptionStatus?: string | null;
    siteAddressDifferent?: boolean;
    siteName?: string | null;
    siteAddress?: string | null;
    sitePlz?: string | null;
    siteCity?: string | null;
    siteNote?: string | null;
    workSites?: Array<
      OfferExecutionSite & {
        id?: string;
        isPrimary?: boolean;
        sortOrder?: number;
      }
    >;
  }[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  currency?: "CHF" | "EUR" | string | null;
  status: string;
  offerDate: string;
  createdAt?: string;
  validUntil: string | null;
  notes: string | null;
}
interface Customer {
  id: string;
  name: string;
  customerNumber?: string | null;
  address?: string | null;
  plz?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
}

const OFFER_HISTORICAL_STATUSES = new Set(["Gesendet", "Abgelehnt"]);

const isHistoricalOfferStatus = (status: unknown) =>
  OFFER_HISTORICAL_STATUSES.has(String(status ?? "").trim());

const statusColors: Record<string, string> = {
  Entwurf: "bg-gray-200 text-gray-800 border border-gray-300",
  Gesendet: "bg-blue-200 text-blue-900 border border-blue-300",
  Angenommen: "bg-green-200 text-green-900 border border-green-300",
  Abgelehnt: "bg-purple-200/60 text-purple-900 border border-purple-300",
  Erledigt: "bg-emerald-200 text-emerald-900 border border-emerald-300",
};

const offerStatuses = ["Entwurf", "Gesendet", "Angenommen", "Abgelehnt"];

const compactOfferValue = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
type OfferCurrencyReviewDetailV17_90L227 = {
  serviceName: string;
  sourceCurrency: string;
  documentCurrency: string;
  originalAmount: number | null;
};

function collectOfferCurrencyReviewDetailsV17_90L227(
  document: Offer,
): OfferCurrencyReviewDetailV17_90L227[] {
  const documentCurrency =
    String(document.currency || "CHF").trim().toUpperCase() || "CHF";
  const sourceText = (document.orders || [])
    .flatMap((order: any) => [order?.notes, order?.description, order?.audioTranscript])
    .filter(Boolean)
    .join("\n");
  const seen = new Set<string>();
  const details: OfferCurrencyReviewDetailV17_90L227[] = [];

  for (const order of document.orders || []) {
    for (const rawReason of order?.reviewReasons || []) {
      const parts = String(rawReason || "")
        .split(":")
        .map((part) => compactOfferValue(part));
      if (!["item_currency_mismatch", "currency_conflict_item"].includes(parts[0])) {
        continue;
      }
      const serviceName = parts[1] || "Leistung";
      const sourceCurrency = String(parts[2] || "").toUpperCase();
      const targetCurrency = String(parts[3] || documentCurrency).toUpperCase();
      const key = `${serviceName.toLowerCase()}|${sourceCurrency}|${targetCurrency}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const escapedCurrency = sourceCurrency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const amountPatterns = escapedCurrency
        ? [
            new RegExp(`\\b${escapedCurrency}\\s*(\\d+(?:[.,]\\d{1,2})?)`, "i"),
            new RegExp(`\\b(\\d+(?:[.,]\\d{1,2})?)\\s*${escapedCurrency}\\b`, "i"),
          ]
        : [];
      let originalAmount: number | null = null;
      for (const pattern of amountPatterns) {
        const match = sourceText.match(pattern);
        const parsed = Number(String(match?.[1] || "").replace(",", "."));
        if (Number.isFinite(parsed) && parsed > 0) {
          originalAmount = parsed;
          break;
        }
      }

      details.push({
        serviceName,
        sourceCurrency: sourceCurrency || "prüfen",
        documentCurrency: targetCurrency || documentCurrency,
        originalAmount,
      });
    }
  }
  return details;
}

function formatOfferCurrencyReviewTooltipV17_90L227(
  details: OfferCurrencyReviewDetailV17_90L227[],
): string {
  return [
    "Währung prüfen",
    ...details.map((detail) => {
      const original =
        detail.originalAmount && detail.originalAmount > 0
          ? `${detail.sourceCurrency} ${detail.originalAmount.toFixed(2)}`
          : detail.sourceCurrency;
      return `• ${detail.serviceName} — Original ${original}, Dokumentwährung ${detail.documentCurrency} · nicht berechnet`;
    }),
  ].join("\n");
}



// V17.90L168: Die vorhandenen Trennlinien bleiben feste Layoutgrenzen.
// Nur ein reines Datum wird im Terminchip ausgeschrieben; jeder Zusatz zeigt nur das Kalendersymbol.
type AdaptiveAppointmentLabels = {
  full: string;
  dateOnly: string | null;
};

const buildAdaptiveAppointmentLabels = (value: unknown): AdaptiveAppointmentLabels => {
  const full = compactOfferValue(value);
  const dateMatch = full.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\.?$/);
  if (!dateMatch) return { full, dateOnly: null };
  const day = dateMatch[1].padStart(2, "0");
  const month = dateMatch[2].padStart(2, "0");
  const year = dateMatch[3] || "";
  return {
    full,
    dateOnly: year ? `${day}.${month}.${year}` : `${day}.${month}.`,
  };
};


// V17.90L169: Einheitlich gegliederte Termin-, Warn- und Besonderheitenfenster.
type StructuredOfferAppointmentTooltipV17_90L169 = {
  date: string;
  time: string;
  note: string;
  fallback: string;
};

const parseOfferAppointmentTooltipV17_90L169 = (
  value: unknown,
): StructuredOfferAppointmentTooltipV17_90L169 => {
  const fallback = compactOfferValue(value);
  const source = fallback.replace(/\n+/g, " · ").replace(/\s+/g, " ").trim();
  const dateMatch = source.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\.?\b/);
  const date = dateMatch
    ? `${dateMatch[1].padStart(2, "0")}.${dateMatch[2].padStart(2, "0")}.${
        dateMatch[3] ? String(dateMatch[3]).padStart(2, "0") : ""
      }`
    : "";
  const sourceWithoutDate = dateMatch ? source.replace(dateMatch[0], " ") : source;
  const clockMatches = Array.from(
    sourceWithoutDate.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g),
  ).map((match) => `${match[1].padStart(2, "0")}:${match[2]}`);
  const uniqueTimes = Array.from(new Set(clockMatches));
  const time =
    uniqueTimes.length >= 2
      ? `${uniqueTimes[0]}–${uniqueTimes[1]} Uhr`
      : uniqueTimes[0]
        ? `${uniqueTimes[0]} Uhr`
        : "";
  let note = source;
  if (dateMatch) note = note.replace(dateMatch[0], " ");
  note = note
    .replace(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g, " ")
    .replace(/\b(?:Ausführungstermin|Ausfuehrungstermin|Termin|Uhr)\b/gi, " ")
    .replace(/[·•|]+/g, " ")
    .replace(/\s*[–—-]\s*(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(?:um|von|bis)\s+/i, "")
    .replace(/[,:;\-–—.\s]+$/g, "")
    .replace(/^[,:;\-–—.\s]+/g, "")
    .trim();
  return { date, time, note, fallback };
};

const serializeOfferExecutionSitesForEdit = (
  sites: OfferExecutionSite[],
) =>
  JSON.stringify(
    (sites || []).map((site) => ({
      siteName: compactOfferValue(site.siteName),
      siteAddress: compactOfferValue(site.siteAddress),
      sitePlz: compactOfferValue(site.sitePlz),
      siteCity: compactOfferValue(site.siteCity),
      siteNote: compactOfferValue(site.siteNote),
      sourceOrderId: compactOfferValue(site.sourceOrderId),
    })),
  );

const pickBestOfferCustomerName = (...values: unknown[]) => {
  const candidates = values
    .map((value) => compactOfferValue(value))
    .filter(Boolean);

  const completeNames = candidates.filter((name) => {
    if (name.length <= 1) return false;
    if (/^[–—-]+$/.test(name)) return false;
    return !isFallbackCustomerName(name);
  });

  const pool = completeNames.length > 0 ? completeNames : candidates;
  return (
    pool.sort((left, right) => {
      const leftWords = left.split(/\s+/).filter(Boolean).length;
      const rightWords = right.split(/\s+/).filter(Boolean).length;
      if (rightWords !== leftWords) return rightWords - leftWords;
      return right.length - left.length;
    })[0] || "–"
  );
};

const offerSiteKey = (site: OfferExecutionSite) =>
  [site.siteName, site.siteAddress, site.sitePlz, site.siteCity, site.siteNote]
    .map((value) => compactOfferValue(value).toLowerCase())
    .join("|");

function collectOfferExecutionSites(offer: Offer): OfferExecutionSite[] {
  const sites: OfferExecutionSite[] = [];
  const addSite = (candidate?: OfferExecutionSite | null) => {
    if (!candidate) return;
    const site: OfferExecutionSite = {
      siteName: compactOfferValue(candidate.siteName) || null,
      siteAddress: compactOfferValue(candidate.siteAddress) || null,
      sitePlz: compactOfferValue(candidate.sitePlz) || null,
      siteCity: compactOfferValue(candidate.siteCity) || null,
      siteNote: compactOfferValue(candidate.siteNote) || null,
      sourceOrderId: compactOfferValue(candidate.sourceOrderId) || null,
    };
    if (
      !site.siteName &&
      !site.siteAddress &&
      !site.sitePlz &&
      !site.siteCity &&
      !site.siteNote
    )
      return;
    const key = offerSiteKey(site);
    if (!sites.some((existing) => offerSiteKey(existing) === key)) {
      sites.push(site);
    }
  };

  (offer.items || []).forEach((item: any) =>
    addSite({
      siteName: item?.siteName,
      siteAddress: item?.siteAddress,
      sitePlz: item?.sitePlz,
      siteCity: item?.siteCity,
      siteNote: item?.siteNote,
      sourceOrderId: item?.sourceOrderId,
    }),
  );

  (offer.orders || []).forEach((order) => {
    const workSites = Array.isArray(order.workSites)
      ? [...order.workSites].sort(
          (a, b) =>
            Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)) ||
            Number(a?.sortOrder ?? 0) - Number(b?.sortOrder ?? 0),
        )
      : [];
    workSites.forEach((site) => addSite({ ...site, sourceOrderId: order.id }));

    if (workSites.length === 0 || order.siteAddressDifferent) {
      addSite({
        siteName: order.siteName,
        siteAddress: order.siteAddress,
        sitePlz: order.sitePlz,
        siteCity: order.siteCity,
        siteNote: order.siteNote,
        sourceOrderId: order.id,
      });
    }
  });

  return sites;
}


type OfferItemGroup = {
  key: string;
  site: OfferExecutionSite | null;
  entries: Array<{ item: OfferItem; index: number }>;
  subtotal: number;
};

function groupOfferItemsByExecutionSite(
  sourceItems: OfferItem[],
  sites: OfferExecutionSite[] = [],
): OfferItemGroup[] {
  const groups = new Map<string, OfferItemGroup>();
  const normalizedSites = sites.filter(Boolean);
  sourceItems.forEach((item, index) => {
    const matchedSite =
      normalizedSites.find((site) => offerSiteKey(site) === offerSiteKey(item)) ||
      (item.sourceOrderId
        ? normalizedSites.find((site) => site.sourceOrderId === item.sourceOrderId)
        : undefined) ||
      (normalizedSites.length === 1 ? normalizedSites[0] : null);
    const key = matchedSite
      ? `${matchedSite.sourceOrderId || ''}|${offerSiteKey(matchedSite)}`
      : `${item.sourceOrderId || ''}|${offerSiteKey(item) || 'general'}`;
    const site = matchedSite ||
      (item.siteName || item.siteAddress || item.sitePlz || item.siteCity
        ? {
            siteName: item.siteName || null,
            siteAddress: item.siteAddress || null,
            sitePlz: item.sitePlz || null,
            siteCity: item.siteCity || null,
            siteNote: item.siteNote || null,
            sourceOrderId: item.sourceOrderId || null,
          }
        : null);
    const lineTotal = Number(item.quantity || 0) * Number(item.unitPrice || 0);
    const group = groups.get(key) || { key, site, entries: [], subtotal: 0 };
    group.entries.push({ item, index });
    group.subtotal += Number.isFinite(lineTotal) ? lineTotal : 0;
    groups.set(key, group);
  });
  return Array.from(groups.values());
}

function buildOfferGroupReviewRows(
  group: OfferItemGroup,
  services: any[],
  currency: "CHF" | "EUR",
): string[] {
  return group.entries.flatMap(({ item }) => {
    const name = String(item?.description || "").trim() || "Neue Leistung";
    const quantity = Number(item?.quantity || 0);
    const unitPrice = Number(item?.unitPrice || 0);
    const unit = String(item?.unit || "").trim();
    const matched = (services || []).find(
      (service: any) =>
        normalizeOfferHint(service?.name) === normalizeOfferHint(name),
    );
    const reasons: string[] = [];
    if (!name || quantity <= 0 || unitPrice <= 0 || !unit || /(?:prüfen|pruefen|prufen)/i.test(unit))
      reasons.push("Preis, Menge oder Einheit prüfen");
    if (!matched) reasons.push("nicht im Leistungskatalog");
    if (matched) {
      const catalogPrice = Number(matched?.defaultPrice || 0);
      const catalogUnit = String(matched?.unit || "").trim();
      if (catalogUnit && catalogUnit !== unit)
        reasons.push(`Einheit: ${unit || "–"} statt ${catalogUnit}`);
      if (Math.abs(catalogPrice - unitPrice) >= 0.001)
        reasons.push(`Preis: ${formatCurrency(unitPrice, currency)} statt ${formatCurrency(catalogPrice, currency)}`);
    }
    return reasons.length > 0 ? [`${name}
${reasons.join(" · ")}`] : [];
  });
}

function getOfferMergedCount(offer: Offer): number {
  const orderCount = Array.isArray(offer.orders) ? offer.orders.length : 0;
  const originCount = Math.max(
    0,
    ...(offer.orders || []).map((order) =>
      Array.isArray(order.originOrderIds) ? order.originOrderIds.filter(Boolean).length : 0,
    ),
  );
  const hasMergeReason = (offer.orders || []).some((order) =>
    (order.reviewReasons || []).some((reason) =>
      ['manual_order_merge', 'double_merge'].includes(String(reason || '')),
    ),
  );
  return Math.max(orderCount, originCount, hasMergeReason ? 2 : 0);
}

function getOfferValidDays(offer: Offer) {
  const start = offer.offerDate ? new Date(offer.offerDate) : null;
  const end = offer.validUntil ? new Date(offer.validUntil) : null;
  if (
    start &&
    end &&
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime())
  ) {
    return String(
      Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000)),
    );
  }
  return "14";
}

function buildOfferPdfTextSuggestion(offer: Offer) {
  const summaries = Array.from(
    new Set(
      (offer.orders || [])
        .map((order) => String(order?.description || "").trim())
        .filter(Boolean),
    ),
  );
  if (summaries.length > 0) return summaries.join("\n\n");

  const services = Array.from(
    new Set(
      (offer.items || [])
        .map((item: any) => String(item?.description || "").trim())
        .filter(Boolean),
    ),
  );
  return services.length > 0
    ? `Gerne bieten wir Ihnen die nachfolgend aufgeführten Leistungen an: ${services.join(", ")}.`
    : "Gerne unterbreiten wir Ihnen das nachfolgende Angebot.";
}

function cleanOfferPdfTextForEditor(
  offer: Offer,
  linkedOrder?: NonNullable<Offer["orders"]>[number],
) {
  if (!String(offer.notes || "").startsWith(OFFER_PDF_META_PREFIX)) return "";
  const cleanNotes = stripForwardedMessage(
    offer.notes,
    linkedOrder?.notes,
  ).trim();
  if (!cleanNotes) return "";

  const automaticSummary = String(linkedOrder?.description || "").trim();
  const automaticSuggestion = buildOfferPdfTextSuggestion(offer).trim();
  if (automaticSummary && cleanNotes === automaticSummary) return "";
  if (automaticSuggestion && cleanNotes === automaticSuggestion) return "";
  return cleanNotes;
}

function applyExecutionSitesToOfferItems(
  sourceItems: OfferItem[],
  sites: OfferExecutionSite[],
): OfferItem[] {
  const cleanSites = sites.filter((site) =>
    Boolean(
      compactOfferValue(site.siteName) ||
      compactOfferValue(site.siteAddress) ||
      compactOfferValue(site.sitePlz) ||
      compactOfferValue(site.siteCity) ||
      compactOfferValue(site.siteNote),
    ),
  );

  if (cleanSites.length === 0) {
    return sourceItems.map((item) => ({
      ...item,
      siteName: null,
      siteAddress: null,
      sitePlz: null,
      siteCity: null,
      siteNote: null,
      sourceOrderId: item.sourceOrderId || null,
    }));
  }

  return sourceItems.map((item) => {
    const currentKey = offerSiteKey(item);
    const site =
      cleanSites.find((candidate) => offerSiteKey(candidate) === currentKey) ||
      (item.sourceOrderId
        ? cleanSites.find(
            (candidate) => candidate.sourceOrderId === item.sourceOrderId,
          )
        : undefined) ||
      (cleanSites.length === 1 ? cleanSites[0] : undefined);

    if (!site) return item;
    return {
      ...item,
      siteName: compactOfferValue(site.siteName) || null,
      siteAddress: compactOfferValue(site.siteAddress) || null,
      sitePlz: compactOfferValue(site.sitePlz) || null,
      siteCity: compactOfferValue(site.siteCity) || null,
      siteNote: compactOfferValue(site.siteNote) || null,
      sourceOrderId: site.sourceOrderId || item.sourceOrderId || null,
    };
  });
}

function extractOfferAppointmentLabel(value?: string | null): string {
  const source = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\[(?:HINWEIS|NOTE)\]\s*/gi, "");
  const line = source
    .split(/\n+/g)
    .map((entry) => entry.trim())
    .find((entry) =>
      /\b(?:termin|datum|zeitfenster|appointment)\b/i.test(entry),
    );
  if (!line) return "";

  const date = line.match(/\b(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?\b/);
  // A dot belongs to Swiss/German dates as well. Therefore only real clock
  // values with a colon are accepted after the detected date was removed.
  // This prevents 18.06.2026 from becoming the false time 18:06.
  const lineWithoutDate = date ? line.replace(date[0], " ") : line;
  const timeMatches = Array.from(
    lineWithoutDate.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g),
  );
  const timeLabels = timeMatches
    .map((match) => `${match[1].padStart(2, "0")}:${match[2]}`)
    .filter((time, index, all) => all.indexOf(time) === index);
  const timeLabel =
    timeLabels.length >= 2
      ? `${timeLabels[0]}–${timeLabels[1]}`
      : timeLabels[0] || "";

  if (date) {
    const dateLabel = `${date[1].padStart(2, "0")}.${date[2].padStart(2, "0")}.`;
    return `Termin ${dateLabel}${timeLabel ? ` ${timeLabel}` : ""}`;
  }

  if (timeLabel) return `Termin ${timeLabel}`;
  return line.length > 38 ? `${line.slice(0, 35).trim()}…` : line;
}


function extractMergedOfferAppointmentLabelV17_90L175(orders?: any[] | null): string {
  const entries = (Array.isArray(orders) ? orders : [])
    .map((order, index) => {
      // V17.90L264: order.date is the administrative order date, never an
      // execution appointment. Appointment display is allowed only when the
      // customer/manual source contains explicit appointment evidence.
      const label = extractOfferAppointmentLabel(
        [order?.specialNotes, order?.notes, order?.description, order?.audioTranscript]
          .filter(Boolean)
          .join("\n"),
      );
      if (!label) return null;
      const site =
        compactOfferValue(order?.workSites?.[0]?.siteName) ||
        compactOfferValue(order?.siteName) ||
        compactOfferValue(order?.executionSiteName) ||
        `Arbeitsort ${index + 1}`;
      return { site, label };
    })
    .filter(Boolean) as Array<{ site: string; label: string }>;

  const unique = entries.filter(
    (entry, index, all) =>
      all.findIndex(
        (candidate) =>
          normalizeOfferHint(candidate.site) === normalizeOfferHint(entry.site) &&
          normalizeOfferHint(candidate.label) === normalizeOfferHint(entry.label),
      ) === index,
  );
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0].label;
  return [`Termine · ${unique.length}`, ...unique.map((entry, index) => `${index + 1}. ${entry.site}: ${entry.label}`)].join("\n");
}

const OFFER_PDF_META_PREFIX = "[[SMARTFLOW_OFFER_PDF_V1]]";

type OfferPdfMeta = { title: string; text: string };

function OfferWhatsAppPdfIcon({
  className = "h-4 w-4",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5.2 19.1 6 15.9a7.4 7.4 0 1 1 2.8 2.7z" />
      <path d="M9.1 8.7c.2-.5.4-.5.7-.5h.5c.2 0 .4.1.5.4l.7 1.6c.1.3.1.5-.1.7l-.4.5c.6 1.1 1.4 1.9 2.5 2.5l.5-.4c.2-.2.5-.2.7-.1l1.6.7c.3.1.4.3.4.5v.5c0 .3 0 .5-.5.7-.6.3-1.4.4-2.5 0-2.4-.8-4.4-2.8-5.2-5.2-.4-1.1-.3-1.9 0-2.5z" />
    </svg>
  );
}

function OfferDirectPdfIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6 shrink-0"
      aria-hidden="true"
    >
      <path
        d="M6.5 2.75h7l4 4v14.5h-11z"
        fill="white"
        stroke="#dc2626"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 2.75v4h4"
        fill="none"
        stroke="#dc2626"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <rect x="4.15" y="11" width="15.7" height="6.45" rx="1.25" fill="#dc2626" />
      <text
        x="12"
        y="15.55"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="4.75"
        fontWeight="800"
        fill="white"
      >
        PDF
      </text>
    </svg>
  );
}

function OfferPdfDocumentIcon() {
  return (
    <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
      <FileText className="h-5 w-5" strokeWidth={1.9} />
      <span className="absolute inset-x-[3px] top-[7px] rounded-[2px] bg-current px-[1px] py-[0.5px] text-center text-[5px] font-black leading-none text-white dark:text-slate-950">
        PDF
      </span>
    </span>
  );
}

function OfferPdfWhatsAppIcon() {
  return (
    <span className="relative inline-flex h-5 w-6 shrink-0 items-center justify-start">
      <OfferPdfDocumentIcon />
      <span className="absolute -bottom-1 -right-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-emerald-200 bg-emerald-500 text-white shadow-sm dark:border-emerald-700">
        <OfferWhatsAppPdfIcon className="h-3 w-3" />
      </span>
    </span>
  );
}

type OfferOperationalChip = {
  key: string;
  title: string;
  icon: string;
  tone: "danger" | "warning";
};

function decodeOfferPdfMeta(value?: string | null): OfferPdfMeta {
  const raw = String(value ?? "").trim();
  if (!raw) return { title: "", text: "" };
  if (!raw.startsWith(OFFER_PDF_META_PREFIX)) {
    return { title: "", text: "" };
  }
  try {
    const parsed = JSON.parse(raw.slice(OFFER_PDF_META_PREFIX.length));
    return {
      title: String(parsed?.title ?? "").trim(),
      text: String(parsed?.text ?? "").trim(),
    };
  } catch {
    return { title: "", text: raw };
  }
}

function encodeOfferPdfMeta(title?: string | null, text?: string | null): string {
  const cleanTitle = String(title ?? "").trim();
  const cleanText = String(text ?? "").trim();
  if (!cleanTitle && !cleanText) return "";
  return `${OFFER_PDF_META_PREFIX}${JSON.stringify({
    title: cleanTitle,
    text: cleanText,
  })}`;
}

function normalizeOfferHint(value?: string | null): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9\s/+.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getOfferServiceReviewReasonV17_90L134(
  item: OfferItem,
  services: any[],
): string {
  const name = String(item?.description || "").trim();
  const quantity = Number(item?.quantity || 0);
  const price = Number(item?.unitPrice || 0);
  const unit = String(item?.unit || "").trim();
  if (!name) return "Leistung prüfen";
  if (quantity <= 0) return "Menge prüfen";
  if (!unit || /(?:prüfen|pruefen|prufen)/i.test(unit)) return "Einheit prüfen";
  if (price <= 0) return "Preis prüfen";
  const catalog = (services || []).find(
    (service: any) => normalizeOfferHint(service?.name) === normalizeOfferHint(name),
  );
  if (!catalog) return "Nicht im Leistungskatalog";
  const catalogUnit = String(catalog?.unit || "").trim();
  const catalogPrice = Number(catalog?.defaultPrice || 0);
  if (catalogUnit && catalogUnit !== unit) return "Einheit abweichend";
  if (catalogPrice > 0 && Math.abs(catalogPrice - price) >= 0.001)
    return "Preis abweichend";
  return "";
}

function uniqueOfferLines(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const line = String(raw ?? "").replace(/\s+/g, " ").trim();
    const key = normalizeOfferHint(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }
  return result;
}

// V17.90L66: Information can arrive from normalized specialNotes, technical
// marker lines and the original WhatsApp text. Clean those transport markers
// and deduplicate semantically before the same information is shown in blue,
// red or yellow blocks.
function cleanOfferInfoLineV17_66(value?: string | null): string {
  const line = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^\s*[-•*]+\s*/g, "")
    .replace(/^\s*\[(?:HINWEIS|INFO|NOTIZ|GEFAHR|WARNUNG|WARNHINWEIS)\]\s*/i, "")
    .replace(/^\s*(?:wichtige informationen|ausgewählter hinweis|weitere besonderheiten|besonderheiten)\s*:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!line) return "";
  if (/^(?:whatsapp|sms|telefon|e-?mail|kundennachricht)\s*:?$/i.test(line)) return "";
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function offerInfoTokensV17_66(value: string): Set<string> {
  const stop = new Set([
    "bitte", "vorher", "zuerst", "nur", "der", "die", "das", "den", "dem",
    "ein", "eine", "einer", "und", "oder", "mit", "bei", "im", "in", "am",
    "ist", "sind", "wird", "werden", "soll", "sollen", "kontakt", "bevorzugt",
    "waehrend", "während", "daher", "deshalb", "bleibt", "geoeffnet", "geöffnet",
    "reinigung",
  ]);
  return new Set(
    normalizeOfferHint(value)
      .split(/\s+/g)
      .filter((token) => token.length >= 3 && !stop.has(token)),
  );
}

function offerInfoLinesEquivalentV17_66(left: string, right: string): boolean {
  const a = normalizeOfferHint(left);
  const b = normalizeOfferHint(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 12 && longer.includes(shorter) && shorter.length / longer.length >= 0.58) {
    return true;
  }

  const aTokens = offerInfoTokensV17_66(left);
  const bTokens = offerInfoTokensV17_66(right);
  if (aTokens.size < 2 || bTokens.size < 2) return false;
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  const smallerSize = Math.min(aTokens.size, bTokens.size);
  return overlap >= 2 && overlap / smallerSize >= 0.72;
}

function uniqueOfferInfoLinesV17_66(values: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  for (const raw of values) {
    const line = cleanOfferInfoLineV17_66(raw);
    if (!line) continue;
    if (result.some((existing) => offerInfoLinesEquivalentV17_66(existing, line))) continue;
    result.push(line);
  }
  return result;
}


type OfferInfoSummary = {
  safety: string[];
  primary: string[];
  additional: string[];
};

function isOfferPrimaryInfoHint(value: string): boolean {
  const text = normalizeOfferHint(value);
  if (!text) return false;
  return /\b(?:termin|zeitfenster|ankunft|ankommen|vorher|zuerst|kontakt vor ort|kontaktperson|ansprechperson|sms|whatsapp|telefonisch|anrufen|rueckruf|nicht einfach|ankuendigung|empfang|zugang|besucherausweis|melden)\b/.test(text);
}

function extractOfferAppointmentSnippets(value?: string | null): string[] {
  const source = String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!source.trim()) return [];
  const weekday = "(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)";
  const matches: string[] = [];
  const patterns = [
    new RegExp(`(?:^|\\n)\\s*((?:termin|zeitfenster)\\s*[:\\-–—]?\\s*[^\\n]{1,180})`, "gi"),
    new RegExp(`(?:^|\\n)\\s*((?:am\\s+)?${weekday}[^\\n]{1,180})`, "gi"),
    /(?:^|\n)\s*((?:genaue\s+ankunft|ankunft)\s+[^\n]{1,180})/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      const line = String(match[1] || "").replace(/\s+/g, " ").trim();
      if (line) matches.push(line);
    }
  }
  return uniqueOfferLines(matches);
}

function extractOfferImportantInstructionLines(value?: string | null): string[] {
  const source = String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!source.trim()) return [];
  return uniqueOfferLines(
    source
      .split(/\n+|(?<=[.!?])\s+/g)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) =>
        line.length > 0 &&
        line.length <= 220 &&
        /\b(?:nichts verschieben|nicht verschieben|keine geraete|keine geräte|nicht ausstecken|nicht bewegen|nicht anfassen|nicht einfach|ankuendigung|ankündigung|empfang|besucherausweis|kontakt vor ort|sms|whatsapp|ankunft)\b/i.test(line),
      ),
  );
}

function isOfferParkingLineV17_90L101(value?: string | null): boolean {
  return /\b(?:[a-z0-9-]*parkplatz|park(?:en|ieren)?|parking|stellplatz|tiefgarage|besucherfeld)\b/i.test(
    normalizeOfferHint(value || ""),
  );
}

// V17.90L237: Angebot/Rechnung erhalten Termin- und Zugangsdaten aus den
// unveränderten Quellaufträgen. Rohtexte werden nur für klar erkennbare
// Zugangssätze verwendet; Leistungszeilen bleiben aus Besonderheiten draußen.
function splitOfferSourceLinesV17_90L237(value: unknown): string[] {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\[(?:HINWEIS|INFO|NOTIZ|GEFAHR|WARNUNG|WARNHINWEIS)\]/gi, "\n")
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => line.replace(/^\s*[-•*]+\s*/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function collectOfferServiceEvidenceLinesV17_90L237(orders: any[]): Set<string> {
  const result = new Set<string>();
  for (const order of orders || []) {
    const raw = String(order?.notes || order?.audioTranscript || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const lines = raw.split(/\n+/g).map((line) => line.replace(/\s+/g, " ").trim());
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      const next = lines.slice(index + 1).find(Boolean) || "";
      const sameLinePrice = /\b(?:CHF|EUR|USD|GBP)\s*\d|\b\d+(?:[.,]\d+)?\s*(?:CHF|EUR|USD|GBP)\b/i.test(line);
      const nextLinePrice = /\b(?:gesamtpreis|pauschalpreis|prix\s+total|prix\s+forfaitaire|total\s+price|flat\s+fee|prezzo\s+totale|precio\s+total)\b.{0,40}\b(?:CHF|EUR|USD|GBP)\b/i.test(next);
      if (sameLinePrice || nextLinePrice) result.add(normalizeOfferHint(line));
    }
  }
  return result;
}

function offerHintMatchesServiceEvidenceV17_90L237(
  value: string,
  evidence: Set<string>,
): boolean {
  const key = normalizeOfferHint(value);
  if (!key) return false;
  for (const candidate of evidence) {
    if (!candidate) continue;
    if (key === candidate) return true;
    const shorter = key.length <= candidate.length ? key : candidate;
    const longer = key.length > candidate.length ? key : candidate;
    if (shorter.length >= 12 && longer.includes(shorter) && shorter.length / longer.length >= 0.72) {
      return true;
    }
  }
  return false;
}

function extractOfferAccessLinesV17_90L237(
  orders: any[],
  serviceNames: string[],
): string[] {
  const serviceKeys = (serviceNames || []).map(normalizeOfferHint).filter(Boolean);
  const result: string[] = [];
  const add = (line: string) => {
    const clean = cleanOfferInfoLineV17_66(line);
    const key = normalizeOfferHint(clean);
    if (!clean || !key) return;
    if (
      serviceKeys.some((serviceKey) =>
        serviceKey.length >= 8 &&
        (key === serviceKey || key.includes(serviceKey) || serviceKey.includes(key)),
      )
    ) return;
    const existingIndex = result.findIndex((entry) => {
      const existing = normalizeOfferHint(entry);
      return existing === key || existing.includes(key) || key.includes(existing);
    });
    if (existingIndex >= 0) {
      if (clean.length > result[existingIndex].length) result[existingIndex] = clean;
      return;
    }
    result.push(clean);
  };

  const accessPattern = /\b(?:schluessel|schlussel|schlüssel|schluesselbox|schlusselbox|schlüsselbox|schluesselkasten|schlusselkasten|schlüsselkasten|tuerkode|turkode|türkode|tuercode|turcode|türcode|zugang|zutritt|seiteneingang|hintereingang|eingangscode|key|keybox|key\s+box|door\s*code|access|entrance|cle|clé|boite\s+a\s+cles|boîte\s+à\s+clés|acces|accès|chiave|codice|ingresso|llave|codigo|código|acceso)\b/i;
  for (const order of orders || []) {
    // V17.90L264: first-AI canonical role text is the authoritative display
    // source. Raw/original text is fallback-only, preventing the same access
    // instruction from appearing in two languages.
    const canonicalLines = splitOfferSourceLinesV17_90L237(order?.specialNotes)
      .filter((line) => accessPattern.test(normalizeOfferHint(line)));
    if (canonicalLines.length > 0) {
      canonicalLines.forEach(add);
      continue;
    }
    for (const source of [order?.notes, order?.audioTranscript]) {
      for (const line of splitOfferSourceLinesV17_90L237(source)) {
        if (accessPattern.test(normalizeOfferHint(line))) add(line);
      }
    }
  }
  return result;
}

function extractOfferParkingLinesV17_90L264(orders: any[]): string[] {
  const result: string[] = [];
  const add = (value: string) => {
    const clean = cleanOfferInfoLineV17_66(value);
    const key = normalizeOfferHint(clean);
    if (!clean || !key) return;
    const existingIndex = result.findIndex((entry) => {
      const existing = normalizeOfferHint(entry);
      return existing === key || existing.includes(key) || key.includes(existing);
    });
    if (existingIndex >= 0) {
      if (clean.length > result[existingIndex].length) result[existingIndex] = clean;
      return;
    }
    result.push(clean);
  };

  for (const order of orders || []) {
    const canonicalLines = splitOfferSourceLinesV17_90L237(order?.specialNotes)
      .filter(isOfferParkingLineV17_90L101);
    if (canonicalLines.length > 0) {
      canonicalLines.forEach(add);
      continue;
    }
    for (const source of [order?.notes, order?.audioTranscript]) {
      splitOfferSourceLinesV17_90L237(source)
        .filter(isOfferParkingLineV17_90L101)
        .forEach(add);
    }
  }
  return result;
}

function isOfferLowInformationHintV17_90L265(value?: string | null): boolean {
  const key = normalizeOfferHint(value || "");
  return [
    "anruf",
    "rueckruf",
    "rueckruf vor arbeitsbeginn",
    "parkplatz pruefen",
    "parkplatz nr",
    "parkplatz nummer",
    "parking pruefen",
    "whatsapp bevorzugt",
    "sms bevorzugt",
    "keine telefonische rueckfrage",
    "nicht anrufen",
  ].includes(key);
}

function isOfferAppointmentCommunicationLineV17_90L266(
  value?: string | null,
): boolean {
  const key = normalizeOfferHint(value || "");
  if (!key) return false;
  const hasAppointmentMarker =
    /\b(?:termin|appointment|ausfuehrungstermin|ausführungstermin|zeitfenster)\b/.test(
      key,
    );
  const hasConcreteDateOrTime =
    /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/.test(key) ||
    /\b\d{1,2}[:.]\d{2}\b/.test(key);
  return hasAppointmentMarker && hasConcreteDateOrTime;
}

function isOfferCommunicationLikeLineV17_90L266(
  value?: string | null,
): boolean {
  return /\b(?:whatsapp|sms|e-?mail|mail|telefonisch|anrufen|anruf|rueckruf|rückruf|kontakt|melden|bescheid|benachrichtigen)\b/i.test(
    String(value || ""),
  );
}

function extractOfferCommunicationInstructionLinesV17_90L265(
  orders: any[],
): string[] {
  const result: string[] = [];
  const add = (value: string) => {
    const clean = cleanOfferInfoLineV17_66(value);
    const key = normalizeOfferHint(clean);
    if (!clean || !key || isOfferLowInformationHintV17_90L265(clean)) return;
    const existingIndex = result.findIndex((entry) => {
      const existing = normalizeOfferHint(entry);
      return existing === key || existing.includes(key) || key.includes(existing);
    });
    if (existingIndex >= 0) {
      if (clean.length > result[existingIndex].length) result[existingIndex] = clean;
      return;
    }
    result.push(clean);
  };
  const communicationPattern =
    /\b(?:whatsapp|sms|e-?mail|mail|telefonisch|anrufen|anruf|rueckruf|rückruf|kontakt|melden|bescheid|benachrichtigen)\b/i;
  for (const order of orders || []) {
    splitOfferSourceLinesV17_90L237(order?.specialNotes)
      .filter(
        (line) =>
          communicationPattern.test(normalizeOfferHint(line)) &&
          !isOfferAppointmentCommunicationLineV17_90L266(line),
      )
      .forEach(add);
  }
  return result;
}

function resolveOfferAppointmentLabelV17_90L237(
  orders: any[],
  fallbackData?: CommunicationData | null,
): string {
  // V17.90L264: Never derive a customer appointment from order.date,
  // createdAt or document timestamps. Only explicit source text is eligible.
  const candidates = [
    ...(orders || []).map((order: any) =>
      extractOfferAppointmentLabel(
        [order?.specialNotes, order?.notes, order?.description, order?.audioTranscript]
          .filter(Boolean)
          .join("\n"),
      ),
    ),
    extractOfferAppointmentLabel(
      [fallbackData?.specialNotes, fallbackData?.notes, fallbackData?.audioTranscript]
        .filter(Boolean)
        .join("\n"),
    ),
  ]
    .map(compactOfferValue)
    .filter(Boolean);
  const concrete = candidates.find((value) => /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/.test(value));
  if (concrete) return concrete;
  return candidates.find((value) => !/termin\s+klären|termin\s+klaeren/i.test(value)) || candidates[0] || "";
}

function compactOfferPrimaryInfoLinesV17_90L124(
  values: string[],
  appointmentLabel: string,
  contactAction?: OfferContactAction | null,
  exactCommunicationLines: string[] = [],
): string[] {
  const retained = values.filter((line) => {
    const text = normalizeOfferHint(line);
    if (!text) return false;
    const isAppointment =
      /\b(?:termin|zeitfenster|arbeitsbeginn|einsatz|ankunft|ankuendigung)\b/.test(
        text,
      ) ||
      /\b\d{1,3}\s+minuten?\s+vorher\b/.test(text);
    const isContact =
      /\b(?:kontakt vor ort|vor ort kontakt|kontaktperson|ansprechperson|whatsapp|sms|anrufen|telefonisch|rueckruf)\b/.test(
        text,
      );
    return !isAppointment && !isContact;
  });

  const contactTitle =
    exactCommunicationLines.length > 0 ? "" : contactAction?.title || "";
  return uniqueOfferInfoLinesV17_66([
    ...retained,
    ...exactCommunicationLines,
    appointmentLabel,
    contactTitle,
  ]);
}

function buildOfferInfoSummary(
  data: CommunicationData,
  parsedNotes = splitSpecialNotes(data.specialNotes),
  appointmentLabel = "",
  contactAction?: OfferContactAction | null,
  sourceOrders: any[] = [],
  serviceNames: string[] = [],
): OfferInfoSummary {
  // V17.90L264: The canonical first-AI role snapshot is preferred for
  // internal display. Raw/original customer text is fallback-only so the same
  // hint is not shown again in another language.
  const canonicalSource = String(data.specialNotes || "").trim();
  const source = canonicalSource || [data.notes, data.audioTranscript].filter(Boolean).join("\n");
  const serviceEvidence = collectOfferServiceEvidenceLinesV17_90L237(sourceOrders);
  const accessLines = extractOfferAccessLinesV17_90L237(sourceOrders, serviceNames);
  const parkingLines = extractOfferParkingLinesV17_90L264(sourceOrders);
  const communicationLines =
    extractOfferCommunicationInstructionLinesV17_90L265(sourceOrders);
  const hasConcreteAppointment = /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/.test(appointmentLabel);
  const dogHints = (parsedNotes.jobHints || []).filter(isOfferDogHint);
  const safety = uniqueOfferInfoLinesV17_66([
    ...(parsedNotes.safetyWarnings || []),
    ...dogHints,
  ]).filter((line) => !isOfferParkingLineV17_90L101(line));
  const importantRawLines = extractOfferImportantInstructionLines(source);
  const appointmentLines = extractOfferAppointmentSnippets(source);
  const primary = uniqueOfferInfoLinesV17_66([
    ...accessLines,
    ...communicationLines,
    ...(parsedNotes.jobHints || [])
      .filter(isOfferPrimaryInfoHint)
      .filter((line) => !isOfferParkingLineV17_90L101(line))
      .filter((line) => !(hasConcreteAppointment && /termin\s+klären|termin\s+klaeren/i.test(line))),
    ...appointmentLines,
    ...importantRawLines.filter(isOfferPrimaryInfoHint),
    appointmentLines.length === 0 ? appointmentLabel : "",
  ]).filter(
    (line) =>
      !offerHintMatchesServiceEvidenceV17_90L237(line, serviceEvidence) &&
      !(communicationLines.length > 0 && isOfferLowInformationHintV17_90L265(line)) &&
      !(parkingLines.length > 0 && isOfferLowInformationHintV17_90L265(line)) &&
      !safety.some((warning) => offerInfoLinesEquivalentV17_66(warning, line)),
  );
  const compactPrimary = compactOfferPrimaryInfoLinesV17_90L124(
    primary,
    appointmentLabel,
    contactAction,
    communicationLines,
  );
  const additional = uniqueOfferInfoLinesV17_66([
    ...parkingLines,
    ...(parsedNotes.jobHints || []).filter(
      (line) =>
        !isOfferDogHint(line) &&
        !isOfferPrimaryInfoHint(line) &&
        !isOfferParkingLineV17_90L101(line),
    ),
    ...importantRawLines.filter(
      (line) =>
        !isOfferPrimaryInfoHint(line) &&
        !isOfferParkingLineV17_90L101(line),
    ),
  ]).filter(
    (line) =>
      !offerHintMatchesServiceEvidenceV17_90L237(line, serviceEvidence) &&
      !(parkingLines.length > 0 && isOfferLowInformationHintV17_90L265(line)) &&
      !(
        communicationLines.length > 0 &&
        (isOfferLowInformationHintV17_90L265(line) ||
          isOfferCommunicationLikeLineV17_90L266(line))
      ) &&
      !safety.some((warning) => offerInfoLinesEquivalentV17_66(warning, line)) &&
      !primary.some((hint) => offerInfoLinesEquivalentV17_66(hint, line)),
  );
  return { safety, primary: compactPrimary, additional };
}

function isOfferDogHint(value: string): boolean {
  return /\b(?:hund|hunde|dog|dogs|chien|chiens|cane|cani|perro|perros)\b/.test(
    normalizeOfferHint(value),
  );
}

type OfferParkingInfoV17_90L101 = {
  status: "Parkplatz verfügbar" | "Parkplatz nicht verfügbar" | "Parkplatz nicht angegeben";
  details: string[];
};

function collectOfferParkingInfoV17_90L101(values: string[]): OfferParkingInfoV17_90L101 {
  const raw = values.filter(Boolean).join("\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const normalized = normalizeOfferHint(raw);
  const details: string[] = [];
  const seen = new Set<string>();
  const push = (value?: string | null) => {
    const clean = String(value || "").replace(/\s+/g, " ").replace(/[.;:,\s]+$/g, "").trim();
    const key = normalizeOfferHint(clean);
    if (!clean || !key || seen.has(key)) return;
    seen.add(key);
    details.push(clean);
  };
  const addMatches = (pattern: RegExp, label: (match: RegExpExecArray) => string) => {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(raw))) push(label(match));
  };

  addMatches(
    /(?:besucher(?:parkplatz|feld)|visitor\s+parking(?:\s+space)?|parking\s+visiteurs?)\s*(?:nummer|nr\.?|no\.?)?\s*[:#-]?\s*([A-Z]?\d+[A-Z]?)/giu,
    (match) => /feld/i.test(match[0])
      ? `Besucherfeld ${String(match[1]).toUpperCase()}`
      : `Besucherparkplatz ${String(match[1]).toUpperCase()}`,
  );
  addMatches(
    /(?:parkplatz|parking)\s+besucher(?:feld)?\s*(?:nummer|nr\.?|no\.?)?\s*[:#-]?\s*([A-Z]?\d+[A-Z]?)/giu,
    (match) => `Besucherparkplatz ${String(match[1]).toUpperCase()}`,
  );
  addMatches(
    /(?:tiefgaragen(?:platz|parkplatz)|underground\s+parking(?:\s+space)?|parking\s+souterrain)\s*(?:nummer|nr\.?|no\.?)?\s*[:#-]?\s*([A-Z]?\d+[A-Z]?)/giu,
    (match) => `Tiefgaragenplatz ${String(match[1]).toUpperCase()}`,
  );
  addMatches(
    /(?:parkplatz|parking\s+space|stellplatz)\s*(?:nummer|nr\.?|no\.?)?\s*[:#-]?\s*([A-Z]\d+[A-Z]?|\d+)/giu,
    (match) => `Parkplatz ${String(match[1]).toUpperCase()}`,
  );

  const durationPattern = /(?:maximal|max\.?|höchstens|hoechstens|maximum|up\s+to)\s*(\d+(?:[.,]\d+)?)\s*(minuten?|minutes?|stunden?|hours?|std\.?|h)\b/giu;
  let durationMatch: RegExpExecArray | null;
  while ((durationMatch = durationPattern.exec(raw))) {
    const amount = String(durationMatch[1]).replace(",", ".");
    const amountNumber = Number(amount);
    const unitKey = normalizeOfferHint(durationMatch[2]);
    const unit = /(?:stund|hour|std|^h$)/.test(unitKey)
      ? amountNumber === 1 ? "Stunde" : "Stunden"
      : amountNumber === 1 ? "Minute" : "Minuten";
    push(`Maximale Parkdauer: ${amount} ${unit}`);
  }

  const hasNegative = /\b(?:kein(?:e[nr]?)?\s+(?:parkplatz|parkmoeglichkeit|stellplatz)|parkverbot|parken\s+verboten|no\s+parking|without\s+parking|sans\s+parking|sin\s+parking)\b/.test(normalized);
  const hasDifficult = /\b(?:(?:parkplatz|parken|parking)\s+(?:schwierig|problematisch|nicht\s+moeglich)|difficult\s+parking)\b/.test(normalized);
  const hasPositive = details.some((line) => !/^Maximale Parkdauer:/i.test(line)) ||
    (/\b(?:parkplatz|parking|stellplatz|tiefgarage)\b/.test(normalized) &&
      /\b(?:benutzen|verwenden|nutzen|verfuegbar|vorhanden|parken|use|available)\b/.test(normalized));

  const specificLocationCodes = new Set(
    details
      .filter((line) => /^(?:Besucherfeld|Besucherparkplatz|Tiefgaragenplatz)\s+/i.test(line))
      .map((line) => line.match(/([A-Z]?\d+[A-Z]?)$/i)?.[1]?.toUpperCase())
      .filter((value): value is string => Boolean(value)),
  );
  const visitorFieldCodes = new Set(
    details
      .filter((line) => /^Besucherfeld\s+/i.test(line))
      .map((line) => line.match(/([A-Z]?\d+[A-Z]?)$/i)?.[1]?.toUpperCase())
      .filter((value): value is string => Boolean(value)),
  );
  const dedupedDetails = details.filter((line) => {
    const code = line.match(/([A-Z]?\d+[A-Z]?)$/i)?.[1]?.toUpperCase();
    if (!code) return true;
    if (/^Parkplatz\s+/i.test(line) && specificLocationCodes.has(code)) return false;
    if (/^Besucherparkplatz\s+/i.test(line) && visitorFieldCodes.has(code)) return false;
    return true;
  });

  return {
    status: hasPositive && !hasNegative && !hasDifficult
      ? "Parkplatz verfügbar"
      : (hasNegative || hasDifficult) && !hasPositive
        ? "Parkplatz nicht verfügbar"
        : "Parkplatz nicht angegeben",
    details: dedupedDetails,
  };
}

function normalizeOfferParkingDetailsV17_90L99(values: string[]): string[] {
  return collectOfferParkingInfoV17_90L101(values).details;
}

function buildOfferParkingChipV17_90L99(
  values: string[],
): OfferOperationalChip | null {
  const parkingValues = values
    .flatMap((value) => String(value || "").split(/\n+/g))
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^(?:parkplatz|parken|parking)\s+(?:nicht\s+angegeben|keine\s+angabe|unbekannt|offen)[.!]?$/i.test(
          normalizeOfferHint(line),
        ),
    );
  const source = parkingValues.join("\n");
  const hasParkingMention =
    /\b(?:[a-z0-9-]*parkplatz|park(?:en|ieren)?|parking|stellplatz|tiefgarage|besucherfeld)\b/i.test(
      normalizeOfferHint(source),
    );
  if (!hasParkingMention) return null;

  const parking = collectOfferParkingInfoV17_90L101(parkingValues);
  return {
    key: "parking",
    title:
      parking.details.length > 0
        ? `${parking.status}\n\n${parking.details.join("\n")}`
        : parking.status,
    icon: "P",
    tone: "warning",
  };
}

function sanitizeOfferDogLineV17_90L175(value?: string | null): string {
  return String(value || "")
    .replace(/^\s*\[(?:GEFAHR|WARNUNG|WARNHINWEIS|HINWEIS|INFO|NOTIZ)\]\s*/i, "")
    .replace(/^\s*Kontakt vor Ort\s*:\s*/i, "")
    .replace(/\s*[·|,-]\s*(?:Tel\.?|Telefon|SMS|WhatsApp|E-?Mail)\b[\s\S]*$/i, "")
    .replace(/\s+(?:Tel\.?|Telefon)\s*[:.]?\s*\+?\d[\d\s()./-]{6,}.*$/i, "")
    .replace(/\s+\+?\d[\d\s()./-]{6,}\s*(?:·|,|-)?\s*(?:nur\s+)?(?:SMS|WhatsApp|anrufen|Telefon).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function offerDogSemanticKeyV17_90L177(value?: string | null): string {
  return normalizeOfferHint(value || "")
    .replace(
      /\b(?:ein|eine|einen|einem|einer|der|die|das|ist|sind|war|waren|befindet|befinden|sich|steht|stehen|sitzt|sitzen|liegt|liegen)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function isBareOfferDogLineV17_90L177(value?: string | null): boolean {
  return /^(?:hund|hunde|dog|dogs|chien|chiens|cane|cani|perro|perros)[.!]?$/i.test(
    String(value || "").trim(),
  );
}

function dedupeOfferDogLinesV17_90L177(values: string[]): string[] {
  const sanitized = values
    .map(sanitizeOfferDogLineV17_90L175)
    .filter(Boolean);
  const descriptive = sanitized.filter(
    (line) => !isBareOfferDogLineV17_90L177(line),
  );
  const source = descriptive.length > 0 ? descriptive : sanitized;
  const result: string[] = [];
  for (const line of source) {
    const key = offerDogSemanticKeyV17_90L177(line);
    if (!key) continue;
    const index = result.findIndex((existing) => {
      const existingKey = offerDogSemanticKeyV17_90L177(existing);
      return (
        existingKey === key ||
        existingKey.includes(key) ||
        key.includes(existingKey)
      );
    });
    if (index >= 0) {
      if (line.length > result[index].length) result[index] = line;
      continue;
    }
    result.push(line);
  }
  return result;
}

function buildOfferOperationalChips(
  safetyWarnings: string[],
  jobHints: string[],
): OfferOperationalChip[] {
  const result: OfferOperationalChip[] = [];
  const pushOrMerge = (chip: OfferOperationalChip) => {
    const existing = result.find((entry) => entry.key === chip.key);
    if (!existing) {
      result.push(chip);
      return;
    }
    existing.title = uniqueOfferLines([existing.title, chip.title]).join("\n");
  };

  // Show a parking chip only when the source actually contains parking information.
  const parkingChip = buildOfferParkingChipV17_90L99([
    ...safetyWarnings,
    ...jobHints,
  ]);
  if (parkingChip) pushOrMerge(parkingChip);

  const safetyAndDogLines = uniqueOfferLines([
    ...safetyWarnings,
    ...jobHints.filter(isOfferDogHint),
  ]);
  const dogLines = dedupeOfferDogLinesV17_90L177(
    safetyAndDogLines.filter(isOfferDogHint),
  );
  if (dogLines.length > 0) {
    pushOrMerge({
      key: "dog",
      title: dogLines.join("\n"),
      icon: "🐶",
      tone: "danger",
    });
  }

  safetyAndDogLines.forEach((line) => {
    const text = normalizeOfferHint(line);
    if (/\b(?:[a-z0-9-]*parkplatz|park(?:en|ieren)?|parking|stellplatz|tiefgarage)\b/.test(text)) return;
    if (isOfferDogHint(line)) return;
    pushOrMerge({ key: "danger", title: line, icon: "⚠️", tone: "danger" });
  });

  uniqueOfferLines(jobHints).forEach((line) => {
    const text = normalizeOfferHint(line);
    if (!text || isOfferDogHint(line)) return;
    if (/\b(?:[a-z0-9-]*parkplatz|park(?:en|ieren)?|parking|stellplatz|tiefgarage)\b/.test(text)) return;
    if (/\b(?:leiter|ladder|echelle|scala|escalera|escada)\b/.test(text)) {
      pushOrMerge({ key: "ladder", title: line, icon: "🪜", tone: "warning" });
      return;
    }
    if (/\b(?:schluessel|schlussel|key|cle|chiave|llave|code|schluesselbox|schlusselbox)\b/.test(text)) {
      pushOrMerge({ key: "key", title: line, icon: "🔑", tone: "warning" });
      return;
    }
    if (/\b(?:zugang|eingang|hintereingang|seiteneingang|tor|door|access|entree|porta|puerta)\b/.test(text)) {
      pushOrMerge({ key: "access", title: line, icon: "🚪", tone: "warning" });
    }
  });
  return result;
}

function renderOfferOperationalChipIcon(chip: OfferOperationalChip) {
  if (chip.key === "dog") {
    return <OfferDangerousDogIcon className="h-5 w-5" />;
  }
  return chip.icon;
}

type OfferContactChannel = "phone" | "whatsapp" | "sms" | "mail";

type OfferContactAction = {
  channel: OfferContactChannel;
  name: string;
  phone: string;
  phoneHref: string;
  email: string;
  minutesBefore: number | null;
  notCall: boolean;
  title: string;
  sourceText: string;
};

type OfferCallbackChip = {
  title: string;
  name: string;
  phone: string;
  displayPhone: string;
  href?: string;
};

function findOfferCommunicationActionHref(
  target: EventTarget | null,
): string {
  const anchor = (target as HTMLElement | null)?.closest?.("a[href]");
  const href = String(anchor?.getAttribute("href") || "").trim();
  return /^(?:tel:|sms:|mailto:|https?:\/\/(?:wa\.me|api\.whatsapp\.com)(?:\/|$))/i.test(
    href,
  )
    ? href
    : "";
}

function normalizeOfferPhoneHref(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const hasLeadingPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6) return "";
  return `${hasLeadingPlus ? "+" : ""}${digits}`;
}

function offerContactPhoneCandidates(value?: string | null): string[] {
  const matches = Array.from(
    String(value || "").matchAll(/(?:\+?\d[\d\s()./-]{6,}\d)/g),
  )
    .map((match) => String(match[0] || "").replace(/\s+/g, " ").trim())
    .filter((candidate) => {
      const digits = candidate.replace(/\D/g, "");
      return digits.length >= 9 && digits.length <= 15;
    });
  return Array.from(new Set(matches));
}

function offerContactEmailCandidates(value?: string | null): string[] {
  return Array.from(
    new Set(
      Array.from(
        String(value || "").matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi),
      ).map((match) => String(match[0] || "").trim()),
    ),
  );
}

function offerContactSourceSegments(
  data: CommunicationData,
): Array<{ text: string; weight: number }> {
  const sources: Array<{ value?: string | null; weight: number }> = [
    { value: data.specialNotes, weight: 30 },
    { value: data.audioTranscript, weight: 15 },
    { value: data.notes, weight: 0 },
  ];
  const result: Array<{ text: string; weight: number }> = [];
  const seen = new Set<string>();

  const push = (text: string, weight: number) => {
    const clean = text
      .replace(/^\s*(?:WhatsApp|Telegram|Kundennachricht)\s*:\s*/i, "")
      .replace(/^\s*[-•*]+\s*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const key = normalizeOfferHint(clean);
    if (!clean || !key || seen.has(key)) return;
    seen.add(key);
    result.push({ text: clean, weight });
  };

  for (const source of sources) {
    const raw = String(source.value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\[(?:HINWEIS|INFO|NOTIZ|GEFAHR|WARNUNG|WARNHINWEIS)\]/gi, "\n");
    if (!raw.trim()) continue;

    raw
      .split(/\n+|(?<=[.!?])\s+/g)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        if (line.length <= 280) {
          push(line, source.weight);
          return;
        }
        const contactMatches = [
          ...offerContactPhoneCandidates(line),
          ...offerContactEmailCandidates(line),
        ];
        if (contactMatches.length === 0) {
          push(line.slice(0, 280), source.weight - 5);
          return;
        }
        contactMatches.forEach((contact) => {
          const index = line.indexOf(contact);
          const from = Math.max(0, index - 120);
          const to = Math.min(line.length, index + contact.length + 150);
          push(line.slice(from, to), source.weight);
        });
      });
  }

  return result;
}

function offerContactChannelFromLine(
  value: string,
): OfferContactChannel | null {
  const text = normalizeOfferHint(value);
  if (!text) return null;

  const negation =
    String.raw`(?:nicht|kein|keine|keinen|ohne|nie|no|not|never|n[oö]d|noed|nod|ned|nid|nit)`;
  const tokenNegated = (tokenPattern: string) =>
    new RegExp(
      String.raw`\b${negation}\b\s+(?:(?:per|via)\s+)?\b(?:${tokenPattern})\b`,
      "i",
    ).test(text);

  const hasWhatsApp = /\bwhatsapp\b/.test(text);
  const hasSms = /\bsms\b/.test(text);
  const whatsappNegated = hasWhatsApp && tokenNegated("whatsapp");
  const smsNegated = hasSms && tokenNegated("sms");

  // Positive channel evidence outranks a merely mentioned but explicitly
  // forbidden channel. Example: "nur per SMS, kein WhatsApp" must stay SMS.
  if (hasSms && !smsNegated && (!hasWhatsApp || whatsappNegated)) return "sms";
  if (hasWhatsApp && !whatsappNegated && (!hasSms || smsNegated)) {
    return "whatsapp";
  }
  if (hasSms && !smsNegated) return "sms";
  if (hasWhatsApp && !whatsappNegated) return "whatsapp";

  if (
    /\b(?:e mail|email|mail|courriel)\b/.test(text) &&
    !tokenNegated("e mail|email|mail|courriel") &&
    /\b(?:nur|only|per|via|an|senden|schicken|melden|kontaktieren|reicht|bevorzugt)\b/.test(
      text,
    )
  ) {
    return "mail";
  }

  const negativeCall = tokenNegated(
    "anrufen|anrufe|rueckruf|rueckrufen|zurueckrufen|telefon|telefonisch|alute|aluete",
  );
  const positiveCall =
    /\b(?:anrufen|rueckruf|rueckrufen|zurueckrufen|telefonisch\s+melden|alute|aluete)\b/.test(
      text,
    );
  return positiveCall && !negativeCall ? "phone" : null;
}

function cleanOfferContactNameCandidate(value?: string | null): string {
  const clean = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[,:;·\-\s]+|[,:;·\-\s]+$/g, "")
    .replace(
      /^(?:arbeitsbeginn|termin|einsatz|ankunft|kontakt(?:\s+vor\s+ort)?|vor[- ]ort[- ]kontakt(?:person)?|ansprechperson|kontaktperson)\s+/i,
      "",
    )
    .trim();
  if (!clean) return "";
  const normalized = normalizeOfferHint(clean);
  const blocked = new Set([
    "kontakt vor ort",
    "vor ort kontaktperson",
    "kontaktperson",
    "ansprechperson",
    "arbeitsbeginn",
    "termin",
    "whatsapp",
    "sms",
    "telefon",
    "email",
    "mail",
  ]);
  if (blocked.has(normalized)) return "";
  const tokens = clean.split(/\s+/g).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return "";
  if (tokens.some((token) => /\d/.test(token))) return "";
  return clean;
}

function extractOfferContactName(
  value: string,
  contactValue?: string | null,
): string {
  const source = String(value || "").replace(/\s+/g, " ").trim();
  if (!source) return "";
  const unicodeName =
    String.raw`[A-ZÄÖÜÀ-Ý][\p{L}'’.-]+(?:\s+[A-ZÄÖÜÀ-Ý][\p{L}'’.-]+){1,3}`;
  const patterns = [
    new RegExp(
      String.raw`(?:kontakt\s+vor\s+ort|vor[- ]ort[- ]kontakt(?:person)?|ansprechperson|kontaktperson)\s*:?\s*(${unicodeName})`,
      "iu",
    ),
    new RegExp(
      String.raw`(?:an|bei)\s+(?:die\s+)?(?:vor[- ]ort[- ]kontaktperson\s+|ansprechperson\s+|kontaktperson\s+|hauswart(?:in)?\s+|vorarbeiter(?:in)?\s+)?(${unicodeName})(?=\s+(?:\+?\d|0\d))`,
      "iu",
    ),
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const candidate = cleanOfferContactNameCandidate(match?.[1]);
    if (candidate) return candidate;
  }

  if (contactValue) {
    const index = source.indexOf(contactValue);
    if (index >= 0) {
      const before = source.slice(0, index).replace(/\bunter\s*$/i, "").trim();
      const match = before.match(
        new RegExp(String.raw`(${unicodeName})\s*$`, "u"),
      );
      const candidate = cleanOfferContactNameCandidate(match?.[1]);
      if (candidate) return candidate;
    }
  }
  return "";
}

function buildOfferContactAction(
  data: CommunicationData,
  customer?: Customer | null,
): OfferContactAction | null {
  const segments = offerContactSourceSegments(data);
  const candidates = segments
    .map((segment) => {
      const channel = offerContactChannelFromLine(segment.text);
      if (!channel) return null;
      const phones = offerContactPhoneCandidates(segment.text);
      const emails = offerContactEmailCandidates(segment.text);
      const phone = phones[0] || "";
      const email = emails[0] || "";
      const normalized = normalizeOfferHint(segment.text);
      const minutesMatch = segment.text.match(/\b(\d{1,3})\s*Min(?:ute)?n?\s*(?:vorher|vor)\b/i);
      const minutesBefore = minutesMatch ? Number(minutesMatch[1]) : null;
      const notCall =
        channel !== "phone" &&
        /\b(?:nicht|kein|keine|keinen|ohne|nie|no|not|never|nöd|noed|nod|ned|nid|nit)\b.{0,45}\b(?:anrufen|anrufe|telefon|telefonisch|alüte|aluete|alute)\b/i.test(
          segment.text,
        );
      const contactValue = channel === "mail" ? email : phone;
      const name = extractOfferContactName(segment.text, contactValue);
      let score = segment.weight + 50;
      if (contactValue) score += 30;
      else score -= 25;
      if (name) score += 12;
      if (minutesBefore) score += 8;
      if (
        /\b(?:kontakt vor ort|vor ort kontakt|kontaktperson|ansprechperson|hauswart|vorarbeiter)\b/.test(
          normalized,
        )
      ) {
        score += 15;
      }
      if (/\b(?:rechnungsadresse|rechnung|buchhaltung|buero|verwaltung)\b/.test(normalized)) {
        score -= 30;
      }
      return {
        channel,
        phone,
        email,
        minutesBefore,
        notCall,
        name,
        score,
        sourceText: segment.text,
      };
    })
    .filter(Boolean) as Array<{
      channel: OfferContactChannel;
      phone: string;
      email: string;
      minutesBefore: number | null;
      notCall: boolean;
      name: string;
      score: number;
      sourceText: string;
    }>;

  const best = candidates.sort((left, right) => right.score - left.score)[0];
  if (!best) return null;

  const fallbackPhone = String(
    customer?.phone || data.customer?.phone || data.phone || "",
  ).trim();
  const fallbackEmail = String(
    customer?.email || data.customer?.email || data.email || "",
  ).trim();
  const phone = best.phone || (best.channel !== "mail" ? fallbackPhone : "");
  const email = best.email || (best.channel === "mail" ? fallbackEmail : "");
  const phoneHref = normalizeOfferPhoneHref(phone);
  const channelLabel =
    best.channel === "whatsapp"
      ? "WhatsApp"
      : best.channel === "sms"
        ? "SMS"
        : best.channel === "mail"
          ? "E-Mail"
          : "Anruf";
  const target = best.channel === "mail" ? email : phone;
  const title = [
    best.name,
    target,
    channelLabel,
    best.minutesBefore ? `${best.minutesBefore} Minuten vorher` : "",
    best.notCall ? "nicht anrufen" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    channel: best.channel,
    name: best.name,
    phone,
    phoneHref,
    email,
    minutesBefore: best.minutesBefore,
    notCall: best.notCall,
    title: title || channelLabel,
    sourceText: best.sourceText,
  };
}

function buildOfferContactChipData(
  data: CommunicationData,
  customer?: Customer | null,
  action?: OfferContactAction | null,
): CommunicationData {
  const compactContext = !action
    ? ""
    : action.channel === "whatsapp"
      ? `Nur WhatsApp an ${action.phone || "gespeicherte Nummer"}.${
          action.minutesBefore ? ` ${action.minutesBefore} Minuten vorher.` : ""
        }${action.notCall ? " Nicht anrufen." : ""}`
      : action.channel === "sms"
        ? `Nur SMS an ${action.phone || "gespeicherte Nummer"}.${
            action.minutesBefore ? ` ${action.minutesBefore} Minuten vorher.` : ""
          }${action.notCall ? " Nicht anrufen." : ""}`
        : action.channel === "mail"
          ? `Nur E-Mail an ${action.email || "gespeicherte E-Mail-Adresse"}.`
          : `Bitte ${action.phone || "gespeicherte Nummer"} anrufen.${
              action.minutesBefore ? ` ${action.minutesBefore} Minuten vorher.` : ""
            }`;

  return {
    ...data,
    customer: action
      ? {
          name: action.name || customer?.name || null,
          email: action.email || null,
          phone: action.phone || null,
        }
      : customer
        ? {
            name: customer.name || null,
            email: customer.email || null,
            phone: customer.phone || null,
          }
        : data.customer,
    email: action?.email || null,
    phone: action?.phone || null,
    specialNotes: "",
    communicationContext: compactContext,
    notes: compactContext,
    audioTranscript: "",
  };
}

function buildOfferCallbackChip(
  action?: OfferContactAction | null,
): OfferCallbackChip | null {
  if (!action || action.channel !== "phone") return null;
  return {
    title: action.title,
    name: action.name || "Kunde",
    phone: action.phoneHref,
    displayPhone:
      action.phone || action.phoneHref || "Keine Telefonnummer vorhanden",
    href: action.phoneHref ? `tel:${action.phoneHref}` : undefined,
  };
}

function OfferViewportTooltipV17_95({
  children,
  align = "left",
  preferredWidth = 352,
}: {
  children: any;
  align?: "left" | "right";
  preferredWidth?: number;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  const clearOpenTimer = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };
  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };
  const clearAutoCloseTimer = () => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  };
  const scheduleAutoClose = () => {
    clearAutoCloseTimer();
    autoCloseTimerRef.current = setTimeout(() => setOpen(false), 3000);
  };

  const calculatePosition = () => {
    const trigger = anchorRef.current?.parentElement as HTMLElement | null;
    if (!trigger || typeof window === "undefined") return null;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 8;
    const width = Math.max(
      240,
      Math.min(preferredWidth, window.innerWidth - viewportPadding * 2),
    );
    const desiredLeft = align === "right" ? rect.right - width : rect.left;
    const left = Math.min(
      Math.max(viewportPadding, desiredLeft),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );
    const availableAbove = Math.max(0, rect.top - gap - viewportPadding);
    const availableBelow = Math.max(
      0,
      window.innerHeight - rect.bottom - gap - viewportPadding,
    );
    const desiredHeight = 320;
    const minimumUsableTooltipSpace = 120;
    const openBelow =
      availableAbove >= minimumUsableTooltipSpace
        ? false
        : availableBelow >= minimumUsableTooltipSpace
          ? true
          : availableBelow > availableAbove;
    const available = openBelow ? availableBelow : availableAbove;
    const maxHeight = Math.max(1, Math.min(560, available));
    return openBelow
      ? { left, width, maxHeight, top: rect.bottom + gap }
      : {
          left,
          width,
          maxHeight,
          bottom: window.innerHeight - rect.top + gap,
        };
  };

  const closeOtherPopovers = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227));
  };

  const openTooltipImmediately = () => {
    closeOtherPopovers();
    clearOpenTimer();
    clearHideTimer();
    const next = calculatePosition();
    if (next) setPosition(next);
    setOpen(true);
  };
  const scheduleShowTooltip = () => {
    clearHideTimer();
    clearOpenTimer();
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      closeOtherPopovers();
      const next = calculatePosition();
      if (next) setPosition(next);
      setOpen(true);
    }, 300);
  };
  const scheduleHide = () => {
    clearOpenTimer();
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => setOpen(false), 500);
  };

  useEffect(() => {
    const trigger = anchorRef.current?.parentElement as HTMLElement | null;
    if (!trigger) return;
    const focusOut = (event: FocusEvent) => {
      if (!trigger.contains(event.relatedTarget as Node | null)) scheduleHide();
    };
    trigger.addEventListener("pointerenter", scheduleShowTooltip);
    trigger.addEventListener("pointerleave", scheduleHide);
    trigger.addEventListener("focusin", openTooltipImmediately);
    const clicked = () => {
      if (open) {
        clearAutoCloseTimer();
        setOpen(false);
        return;
      }
      openTooltipImmediately();
      scheduleAutoClose();
    };
    trigger.addEventListener("focusout", focusOut);
    trigger.addEventListener("click", clicked);
    return () => {
      trigger.removeEventListener("pointerenter", scheduleShowTooltip);
      trigger.removeEventListener("pointerleave", scheduleHide);
      trigger.removeEventListener("focusin", openTooltipImmediately);
      trigger.removeEventListener("focusout", focusOut);
      trigger.removeEventListener("click", clicked);
      clearOpenTimer();
      clearHideTimer();
      clearAutoCloseTimer();
    };
  }); // Ohne Dependency-Array: bei jedem Render an den aktuell sichtbaren Parent-Chip neu binden.

  useEffect(() => {
    const closePopover = () => {
      clearOpenTimer();
      clearHideTimer();
      clearAutoCloseTimer();
      setOpen(false);
    };
    const outside = (event: PointerEvent) => {
      if (!open) return;
      const target = event.target as Node | null;
      const trigger = anchorRef.current?.parentElement as HTMLElement | null;
      if (target && trigger?.contains(target)) return;
      if (target && tooltipRef.current?.contains(target)) return;
      closePopover();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener(SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227, closePopover);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener(SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227, closePopover);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const next = calculatePosition();
      if (next) setPosition(next);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, align, preferredWidth]);

  return (
    <>
      <span ref={anchorRef} className="hidden" aria-hidden="true" />
      {open &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
        <span
          ref={tooltipRef}
          role="tooltip"
          onPointerEnter={() => { clearHideTimer(); clearAutoCloseTimer(); }}
          onPointerDown={clearAutoCloseTimer}
          onPointerUp={scheduleAutoClose}
          onScroll={clearAutoCloseTimer}
          onPointerLeave={scheduleHide}
          style={{
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
            top: position.top,
            bottom: position.bottom,
          }}
          className="pointer-events-auto fixed z-[2147483000] isolate opacity-100 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-3 text-left text-[11px] font-medium leading-snug text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          {children}
        </span>,
          document.body,
        )}
    </>
  );
}

function OfferPlainTooltip({
  text,
  align = "left",
}: {
  text: string;
  align?: "left" | "right";
}) {
  if (!text.trim()) return null;
  return (
    <OfferViewportTooltipV17_95 align={align}>
      <span className="whitespace-pre-wrap break-words">{text}</span>
    </OfferViewportTooltipV17_95>
  );
}


function OfferAppointmentTooltipContentV17_90L169({
  text,
}: {
  text: string;
}) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const multiple = /^Termine\s*·\s*\d+/i.test(lines[0] || "");

  if (multiple) {
    const entries = lines.slice(1).map((line, index) => {
      const cleaned = line.replace(/^\d+\.\s*/, "").trim();
      const [sitePart, ...appointmentParts] = cleaned.split(/\s+—\s+/);
      return {
        site:
          appointmentParts.length > 0
            ? sitePart.trim()
            : `Arbeitsort ${index + 1}`,
        appointment:
          appointmentParts.length > 0
            ? appointmentParts.join(" — ").trim()
            : cleaned,
      };
    });

    return (
      <span className="block rounded-xl border border-violet-300 bg-violet-50 p-3 text-slate-950 dark:border-violet-800/70 dark:bg-violet-950/35 dark:text-slate-50">
        <span className="mb-2 flex items-center gap-2 text-sm font-extrabold leading-tight">
          <CalendarDays className="h-4 w-4 shrink-0 text-violet-700 dark:text-violet-300" />
          {lines[0]}
        </span>
        <span className="block space-y-2">
          {entries.map((entry, index) => (
            <span
              key={`${entry.site}-${entry.appointment}-${index}`}
              className="block rounded-lg border border-violet-200 bg-white/80 p-2.5 dark:border-violet-800/60 dark:bg-slate-950/25"
            >
              <span className="block break-words text-[12px] font-extrabold leading-tight">
                {index + 1}. {entry.site}
              </span>
              <span className="mt-1.5 block text-[12px] font-semibold leading-relaxed">
                {entry.appointment}
              </span>
            </span>
          ))}
        </span>
      </span>
    );
  }

  const parts = parseOfferAppointmentTooltipV17_90L169(text);
  return (
    <span className="block rounded-xl border border-violet-300 bg-violet-50 p-3 text-slate-950 dark:border-violet-800/70 dark:bg-violet-950/35 dark:text-slate-50">
      <span className="flex items-start gap-2">
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-violet-700 dark:text-violet-300" />
        <span className="min-w-0 flex-1">
          {parts.date ? (
            <span className="block text-lg font-extrabold leading-none tracking-tight">
              {parts.date}
            </span>
          ) : (
            <span className="block text-sm font-extrabold leading-tight">
              Termin
            </span>
          )}
          {parts.time && (
            <span className="mt-1.5 block text-sm font-extrabold leading-tight">
              {parts.time}
            </span>
          )}
          {parts.note && (
            <span className="mt-2 block border-t border-violet-200 pt-2 text-[12px] font-medium leading-relaxed dark:border-violet-800/70">
              {parts.note}
            </span>
          )}
          {!parts.date && !parts.time && !parts.note && (
            <span className="mt-1 block text-[12px] font-semibold leading-relaxed">
              {parts.fallback}
            </span>
          )}
        </span>
      </span>
    </span>
  );
}

function OfferAppointmentTooltipV17_90L169({
  text,
  align = "left",
}: {
  text: string;
  align?: "left" | "right";
}) {
  if (!text.trim()) return null;
  return (
    <OfferViewportTooltipV17_95 align={align} preferredWidth={320}>
      <OfferAppointmentTooltipContentV17_90L169 text={text} />
    </OfferViewportTooltipV17_95>
  );
}

function OfferOperationalTooltipContentV17_90L169({
  chip,
}: {
  chip: OfferOperationalChip;
}) {
  const isDanger = chip.tone === "danger";
  const rawLines = String(chip.title || "").split(/\n+/g);
  const lines =
    chip.key === "dog"
      ? dedupeOfferDogLinesV17_90L177(rawLines)
      : uniqueOfferLines(rawLines);
  const heading = isDanger
    ? chip.key === "dog"
      ? "Vorsicht: Hund"
      : "Vorsicht"
    : "Besonderheiten";
  return (
    <span
      className={`block rounded-xl border-2 p-3 text-slate-950 dark:text-slate-50 ${
        isDanger
          ? "border-red-400 bg-red-100 dark:border-red-700 dark:bg-red-950/55"
          : "border-amber-400 bg-amber-100 dark:border-amber-700 dark:bg-amber-950/45"
      }`}
    >
      <span className="mb-2 flex items-center gap-2 text-sm font-extrabold leading-tight">
        <AlertTriangle
          className={`h-4 w-4 shrink-0 ${
            isDanger
              ? "text-red-700 dark:text-red-300"
              : "text-amber-700 dark:text-amber-300"
          }`}
        />
        {heading}
      </span>
      <span className="block space-y-1.5">
        {lines.map((line, index) => (
          <span
            key={`offer_operational_${chip.key}_${index}`}
            className={`block rounded-lg border bg-white/75 px-2.5 py-2 text-[12px] font-semibold leading-relaxed text-slate-950 dark:bg-slate-950/35 dark:text-slate-50 ${
              isDanger
                ? "border-red-200 dark:border-red-900/70"
                : "border-amber-200 dark:border-amber-900/70"
            }`}
          >
            {line}
          </span>
        ))}
      </span>
    </span>
  );
}

function OfferOperationalTooltipV17_90L169({
  chip,
  align = "left",
}: {
  chip: OfferOperationalChip;
  align?: "left" | "right";
}) {
  if (!String(chip.title || "").trim()) return null;
  return (
    <OfferViewportTooltipV17_95 align={align} preferredWidth={360}>
      <OfferOperationalTooltipContentV17_90L169 chip={chip} />
    </OfferViewportTooltipV17_95>
  );
}

function OfferContactTooltip({
  heading,
  name,
  value,
  hint,
  align = "left",
}: {
  heading: string;
  name?: string;
  value: string;
  hint: string;
  align?: "left" | "right";
}) {
  return (
    <OfferViewportTooltipV17_95 align={align} preferredWidth={320}>
      <span className="block text-xs font-semibold text-blue-800 dark:text-blue-200">
        {heading}
      </span>
      <span className="mt-1 block break-words font-medium text-foreground">
        {name || "Kunde"}
      </span>
      <span className="mt-1 block break-words font-mono text-sm text-blue-700 dark:text-blue-300">
        {value}
      </span>
      <span className="mt-2 block text-xs text-muted-foreground">
        {hint}
      </span>
    </OfferViewportTooltipV17_95>
  );
}

function OfferAddressTooltip({ site }: { site: OfferExecutionSite }) {
  return (
    <OfferViewportTooltipV17_95 preferredWidth={400}>
      <span className="mb-2 flex items-center gap-1.5 text-sm font-bold text-sky-800 dark:text-sky-200">
        <MapPin className="h-4 w-4" /> Ausführungsadresse
      </span>
      <span className="grid grid-cols-[76px_1fr] gap-x-2 gap-y-1.5">
        {site.siteName && (
          <>
            <span className="text-muted-foreground">Objekt:</span>
            <span className="break-words font-bold text-slate-950 dark:text-slate-50">
              {site.siteName}
            </span>
          </>
        )}
        <span className="text-muted-foreground">Strasse:</span>
        <span className="break-words">{site.siteAddress || "–"}</span>
        <span className="text-muted-foreground">PLZ / Ort:</span>
        <span className="break-words">
          {[site.sitePlz, site.siteCity].filter(Boolean).join(" ") || "–"}
        </span>
        {site.siteNote && (
          <>
            <span className="text-muted-foreground">Hinweis:</span>
            <span className="break-words">{site.siteNote}</span>
          </>
        )}
      </span>
    </OfferViewportTooltipV17_95>
  );
}

function OfferExecutionSitesTooltip({
  sites,
}: {
  sites: OfferExecutionSite[];
}) {
  if (sites.length === 0) return null;
  return (
    <OfferViewportTooltipV17_95 preferredWidth={420}>
      <span className="mb-2 flex items-center gap-1.5 text-sm font-bold text-sky-800 dark:text-sky-200">
        <MapPin className="h-4 w-4" />
        {sites.length > 1
          ? `Ausführungsorte · ${sites.length}`
          : "Ausführungsadresse"}
      </span>
      <span className="block space-y-2">
        {sites.map((site, siteIndex) => (
          <span
            key={`offer_execution_tooltip_${siteIndex}`}
            className={`block ${
              siteIndex > 0
                ? "border-t border-sky-100 pt-2 dark:border-slate-700"
                : ""
            }`}
          >
            {sites.length > 1 && (
              <span className="mb-1 block font-bold text-slate-950 dark:text-slate-50">
                Arbeitsort {siteIndex + 1}
              </span>
            )}
            <span className="grid grid-cols-[76px_1fr] gap-x-2 gap-y-1.5">
              {site.siteName && (
                <>
                  <span className="text-muted-foreground">Objekt:</span>
                  <span className="break-words font-bold text-slate-950 dark:text-slate-50">
                    {site.siteName}
                  </span>
                </>
              )}
              <span className="text-muted-foreground">Strasse:</span>
              <span className="break-words">{site.siteAddress || "–"}</span>
              <span className="text-muted-foreground">PLZ / Ort:</span>
              <span className="break-words">
                {[site.sitePlz, site.siteCity].filter(Boolean).join(" ") || "–"}
              </span>
              {site.siteNote && (
                <>
                  <span className="text-muted-foreground">Hinweis:</span>
                  <span className="break-words">{site.siteNote}</span>
                </>
              )}
            </span>
          </span>
        ))}
      </span>
    </OfferViewportTooltipV17_95>
  );
}

function OfferInfoTooltip({ summary }: { summary: OfferInfoSummary }) {
  const safety = uniqueOfferLines(summary.safety);
  const primary = uniqueOfferLines(summary.primary);
  const additional = uniqueOfferLines(summary.additional);
  if (safety.length === 0 && primary.length === 0 && additional.length === 0)
    return null;
  return (
    <OfferViewportTooltipV17_95 preferredWidth={400}>
      <span className="block space-y-2">
        {safety.length > 0 && (
          <span className="block rounded-lg border border-red-300 bg-red-50 p-2 text-red-800">
            <span className="mb-1 flex items-center gap-1 font-bold">
              <AlertTriangle className="h-3.5 w-3.5" /> Gefahr / Achtung
            </span>
            {safety.map((line, index) => (
              <span key={`offer_info_safety_${index}`} className="block break-words">
                • {line}
              </span>
            ))}
          </span>
        )}
        {primary.length > 0 && (
          <span className="block rounded-lg border border-blue-300 bg-blue-50 p-2 text-blue-900">
            <span className="mb-1 flex items-center gap-1 font-bold">
              <Info className="h-3.5 w-3.5" /> Wichtige Informationen
            </span>
            {primary.map((line, index) => (
              <span key={`offer_info_primary_${index}`} className="block break-words">
                {line}
              </span>
            ))}
          </span>
        )}
        {additional.length > 0 && (
          <span className="block rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900">
            <span className="mb-1 block font-bold">Weitere Besonderheiten</span>
            {additional.map((line, index) => (
              <span key={`offer_info_hint_${index}`} className="block break-words">
                {line}
              </span>
            ))}
          </span>
        )}
      </span>
    </OfferViewportTooltipV17_95>
  );
}


type OfferServiceReviewItem = {
  title: string;
  details: string[];
};

type OfferServiceReviewSection = {
  title: string;
  items: OfferServiceReviewItem[];
};

type OfferServiceReviewSiteGroup = {
  key: string;
  site: OfferExecutionSite | null;
  count: number;
  sections: OfferServiceReviewSection[];
};

type OfferServiceReviewSummary = {
  blockerCount: number;
  reviewCount: number;
  blockerTooltip: string;
  reviewTooltip: string;
  blockerSections: OfferServiceReviewSection[];
  reviewSections: OfferServiceReviewSection[];
};

function formatOfferReviewNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("de-CH", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function serializeOfferReviewSections(
  sections: OfferServiceReviewSection[],
): string {
  return sections
    .flatMap((section, sectionIndex) => [
      ...(sectionIndex > 0 ? ["---"] : []),
      section.title,
      ...section.items.flatMap((item) => [item.title, ...item.details]),
    ])
    .join("\n");
}

function buildOfferServiceReviewSummary(
  offer: Offer,
  services: any[],
  currency: "CHF" | "EUR",
): OfferServiceReviewSummary {
  const blockers: OfferServiceReviewItem[] = [];
  const deviations: OfferServiceReviewItem[] = [];
  const missingCatalog: OfferServiceReviewItem[] = [];

  (offer.items || []).forEach((item: any) => {
    const name = String(item?.description || "").trim() || "Leistung";
    const quantity = Number(item?.quantity || 0);
    const unitPrice = Number(item?.unitPrice || 0);
    const unit = String(item?.unit || "").trim();
    const normalizedName = normalizeOfferHint(name);
    const matchedService = (services || []).find(
      (service: any) => normalizeOfferHint(service?.name) === normalizedName,
    );
    const currentCalculation = `${formatOfferReviewNumber(quantity)} ${unit || "–"} × ${formatCurrency(unitPrice, currency)} = ${formatCurrency(quantity * unitPrice, currency)}`;

    const blockerReasons = [
      !String(item?.description || "").trim() ? "Leistungsname fehlt" : "",
      quantity <= 0 ? "Menge fehlt oder ist 0" : "",
      unitPrice <= 0 ? "Preis fehlt oder ist 0" : "",
      !unit || /(?:prüfen|pruefen|prufen)/i.test(unit)
        ? "Einheit fehlt oder muss geprüft werden"
        : "",
    ].filter(Boolean);

    if (blockerReasons.length > 0) {
      blockers.push({
        title: name,
        details: [...blockerReasons, `Aktuell: ${currentCalculation}`],
      });
      return;
    }

    if (!matchedService) {
      missingCatalog.push({
        title: name,
        details: [`Aktuell: ${currentCalculation}`],
      });
      return;
    }

    const catalogUnit = String(matchedService?.unit || "").trim();
    const catalogPrice = Number(matchedService?.defaultPrice || 0);
    const sameUnit = !catalogUnit || unit === catalogUnit;
    const samePrice = Math.abs(unitPrice - catalogPrice) < 0.001;

    if (!sameUnit || !samePrice) {
      const differences = [
        !sameUnit
          ? `Einheit weicht ab: ${unit || "–"} statt ${catalogUnit || "–"}`
          : "",
        !samePrice ? "Preis weicht vom Katalog ab." : "",
      ].filter(Boolean);
      deviations.push({
        title: name,
        details: [
          `Aktuell: ${currentCalculation}`,
          `Katalogpreis: ${formatCurrency(catalogPrice, currency)} / ${catalogUnit || "–"}`,
          ...differences,
        ],
      });
    }
  });

  const blockerSections: OfferServiceReviewSection[] = blockers.length
    ? [{ title: "Preis / Menge / Einheit prüfen", items: blockers }]
    : [];
  const reviewSections: OfferServiceReviewSection[] = [
    ...(deviations.length
      ? [{ title: "Preis oder Einheit abweichend", items: deviations }]
      : []),
    ...(missingCatalog.length
      ? [{ title: "Nicht im Leistungskatalog", items: missingCatalog }]
      : []),
  ];

  return {
    blockerCount: blockers.length,
    reviewCount: deviations.length + missingCatalog.length,
    blockerTooltip: serializeOfferReviewSections(blockerSections),
    reviewTooltip: serializeOfferReviewSections(reviewSections),
    blockerSections,
    reviewSections,
  };
}


function buildOfferServiceReviewSiteGroupsV17_90L135G(
  offer: Offer,
  sites: OfferExecutionSite[],
  services: any[],
  currency: "CHF" | "EUR",
  mode: "review" | "blocker" | "all" = "review",
): OfferServiceReviewSiteGroup[] {
  return groupOfferItemsByExecutionSite(offer.items || [], sites)
    .map((group) => {
      const summary = buildOfferServiceReviewSummary(
        { ...offer, items: group.entries.map((entry) => entry.item) },
        services,
        currency,
      );
      const sections =
        mode === "review"
          ? summary.reviewSections
          : mode === "blocker"
            ? summary.blockerSections
            : [...summary.blockerSections, ...summary.reviewSections];
      const count = sections.reduce(
        (sum, section) => sum + section.items.length,
        0,
      );
      return { key: group.key, site: group.site, count, sections };
    })
    .filter((group) => group.count > 0);
}

// V17.90L136: Einheitliche Leistungsdarstellung innen und außen.
function OfferServiceReviewSectionsContentV17_90L135G({
  sections,
}: {
  sections: OfferServiceReviewSection[];
}) {
  return (
    <span className="block">
      {sections.map((section, sectionIndex) => (
        <span
          key={`${section.title}_${sectionIndex}`}
          className={`${sectionIndex > 0 ? "mt-3 border-t border-slate-200 pt-2 dark:border-slate-700" : ""} block`}
        >
          <span className="mb-1.5 block font-bold text-slate-950 dark:text-slate-50">
            {section.title}
          </span>
          {section.items.map((item, itemIndex) => (
            <span
              key={`${item.title}_${itemIndex}`}
              className={`${itemIndex > 0 ? "mt-2" : ""} block`}
            >
              <span className="block break-words font-bold">* {item.title}</span>
              {item.details.map((detail, detailIndex) => {
                const trimmedDetail = detail.trim();
                const isCurrentPrice = /^(?:Aktuell|Berechnung):/i.test(
                  trimmedDetail,
                );
                const isCatalogPrice = /^Katalogpreis:/i.test(trimmedDetail);
                return (
                  <span
                    key={`${item.title}_${detailIndex}`}
                    className={`block break-words ${
                      isCurrentPrice
                        ? "font-bold text-slate-950 dark:text-slate-50"
                        : isCatalogPrice
                          ? "font-normal text-slate-500 dark:text-slate-400"
                          : "text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    {detail}
                  </span>
                );
              })}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

function OfferServiceReviewTooltip({
  title,
  sections,
  siteGroups = [],
  align = "left",
}: {
  title: string;
  sections: OfferServiceReviewSection[];
  siteGroups?: OfferServiceReviewSiteGroup[];
  align?: "left" | "right";
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [activeSiteKey, setActiveSiteKey] = useState<string | null>(null);
  const [position, setPosition] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  const clearOpenTimer = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };
  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const calculatePosition = () => {
    const trigger = anchorRef.current?.parentElement as HTMLElement | null;
    if (!trigger || typeof window === "undefined") return null;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 8;
    const width = Math.max(
      280,
      Math.min(432, window.innerWidth - viewportPadding * 2),
    );
    const desiredLeft = align === "right" ? rect.right - width : rect.left;
    const left = Math.min(
      Math.max(viewportPadding, desiredLeft),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );
    const availableAbove = Math.max(
      0,
      rect.top - gap - viewportPadding,
    );
    const availableBelow = Math.max(
      0,
      window.innerHeight - rect.bottom - gap - viewportPadding,
    );
    const desiredHeight = 320;
    const minimumUsableTooltipSpace = 120;
    const openBelow =
      availableAbove >= minimumUsableTooltipSpace
        ? false
        : availableBelow >= minimumUsableTooltipSpace
          ? true
          : availableBelow > availableAbove;
    const available = openBelow ? availableBelow : availableAbove;
    const maxHeight = Math.max(1, Math.min(560, available));

    return openBelow
      ? {
          left,
          width,
          maxHeight,
          top: rect.bottom + gap,
        }
      : {
          left,
          width,
          maxHeight,
          bottom: window.innerHeight - rect.top + gap,
        };
  };

  const openTooltipImmediately = () => {
    clearOpenTimer();
    clearHideTimer();
    const nextPosition = calculatePosition();
    if (nextPosition) setPosition(nextPosition);
    setOpen(true);
  };
  const scheduleShowTooltip = () => {
    clearHideTimer();
    clearOpenTimer();
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      const nextPosition = calculatePosition();
      if (nextPosition) setPosition(nextPosition);
      setOpen(true);
    }, 300);
  };

  const scheduleHideTooltip = () => {
    clearOpenTimer();
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => setOpen(false), 500);
  };

  useEffect(() => {
    const trigger = anchorRef.current?.parentElement as HTMLElement | null;
    if (!trigger) return;

    const handleFocusOut = (event: FocusEvent) => {
      if (!trigger.contains(event.relatedTarget as Node | null)) {
        scheduleHideTooltip();
      }
    };

    trigger.addEventListener("pointerenter", scheduleShowTooltip);
    trigger.addEventListener("pointerleave", scheduleHideTooltip);
    trigger.addEventListener("focusin", openTooltipImmediately);
    trigger.addEventListener("focusout", handleFocusOut);

    return () => {
      trigger.removeEventListener("pointerenter", scheduleShowTooltip);
      trigger.removeEventListener("pointerleave", scheduleHideTooltip);
      trigger.removeEventListener("focusin", openTooltipImmediately);
      trigger.removeEventListener("focusout", handleFocusOut);
      clearOpenTimer();
      clearHideTimer();
    };
  }); // Ohne Dependency-Array: bei jedem Render an den aktuell sichtbaren Parent-Chip neu binden.

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const nextPosition = calculatePosition();
      if (nextPosition) setPosition(nextPosition);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, align]);

  if (sections.length === 0) return null;

  return (
    <>
      <span ref={anchorRef} className="hidden" aria-hidden="true" />
      {open &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
        <span
          role="tooltip"
          onPointerEnter={clearHideTimer}
          onPointerLeave={scheduleHideTooltip}
          style={{
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
            top: position.top,
            bottom: position.bottom,
          }}
          className="pointer-events-auto fixed z-[2147483000] isolate opacity-100 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-3 text-left text-[11px] font-medium leading-snug text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <span className="mb-2 block text-sm font-bold text-slate-950 dark:text-slate-50">
            {title}
          </span>
          {siteGroups.length > 1 ? (
            <span className="block space-y-2">
              {siteGroups.map((group, index) => {
                const active = activeSiteKey === group.key;
                const address = [
                  group.site?.siteAddress,
                  [group.site?.sitePlz, group.site?.siteCity]
                    .filter(Boolean)
                    .join(" "),
                ].filter(Boolean).join(" · ") || "Adresse nicht angegeben";
                return (
                  <span
                    key={group.key}
                    role="button"
                    tabIndex={0}
                    onPointerEnter={() => setActiveSiteKey(group.key)}
                    onFocus={() => setActiveSiteKey(group.key)}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setActiveSiteKey((current) =>
                        current === group.key ? null : group.key,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      setActiveSiteKey((current) =>
                        current === group.key ? null : group.key,
                      );
                    }}
                    className={`block cursor-pointer overflow-hidden rounded-lg border bg-white outline-none dark:bg-slate-900 ${
                      active
                        ? "border-cyan-300 dark:border-cyan-800"
                        : "border-slate-200 hover:border-cyan-200 dark:border-slate-700"
                    }`}
                  >
                    <span className={`flex items-start justify-between gap-3 p-2 ${
                      active
                        ? "bg-cyan-50 dark:bg-cyan-950/30"
                        : "bg-slate-50 hover:bg-cyan-50/60 dark:bg-slate-900"
                    }`}>
                      <span className="min-w-0">
                        <span className="block font-bold text-slate-950 dark:text-slate-50">
                          {index + 1}. {group.site?.siteName || group.site?.siteAddress || `Ausführungsort ${index + 1}`}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-slate-600 dark:text-slate-300">
                          {address}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                        Leistungen prüfen · {group.count}
                      </span>
                    </span>
                    {active && (
                      <span className="block border-t border-amber-200 bg-amber-50/50 p-2.5 dark:border-amber-900/60 dark:bg-amber-950/15">
                        <OfferServiceReviewSectionsContentV17_90L135G sections={group.sections} />
                      </span>
                    )}
                  </span>
                );
              })}
            </span>
          ) : (
            <OfferServiceReviewSectionsContentV17_90L135G sections={sections} />
          )}
        </span>,
          document.body,
        )}
    </>
  );
}

type OfferMobileTooltipState = {
  key: string;
  text?: string;
  safetyWarnings?: string[];
  primaryHints?: string[];
  jobHints?: string[];
  reviewTitle?: string;
  reviewSections?: OfferServiceReviewSection[];
  reviewSiteGroups?: OfferServiceReviewSiteGroup[];
  kind?: "service_review" | "execution_address" | "default";
  anchorRect?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
  };
};

type OfferCatalogDecision = {
  index: number;
  existing: any;
  name: string;
  price: number;
  unit: string;
};


type ResponsiveOfferServiceRowV17_90L231 = {
  name: string;
  amountLabel: string;
};

function ResponsiveOfferServicePreviewV17_95({
  offerId,
  services,
  expanded,
  onToggle,
  onOpenItems,
}: {
  offerId: string;
  services: ResponsiveOfferServiceRowV17_90L231[];
  expanded: boolean;
  onToggle: () => void;
  onOpenItems: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [useTwoColumns, setUseTwoColumns] = useState(false);
  const serviceKey = services
    .map((service) => `${service.name}\u241f${service.amountLabel}`)
    .join("\u241e");

  useEffect(() => {
    const element = listRef.current;
    if (!element || typeof window === "undefined") return;
    const measure = () => {
      const width = element.clientWidth;
      if (services.length < 2 || width < 620) {
        setUseTwoColumns(false);
        return;
      }
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        setUseTwoColumns(width >= 820);
        return;
      }
      const style = window.getComputedStyle(element);
      context.font =
        style.font ||
        `${style.fontWeight || 400} ${style.fontSize || "12px"} ${
          style.fontFamily || "sans-serif"
        }`;
      const columnWidth = (width - 32) / 2;
      const widestRow = services.reduce((maxWidth, service) => {
        const nameWidth = context.measureText(service.name).width;
        const amountWidth = context.measureText(service.amountLabel).width;
        return Math.max(maxWidth, nameWidth + amountWidth + 52);
      }, 0);
      setUseTwoColumns(widestRow <= columnWidth);
    };
    measure();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [serviceKey, services.length]);

  const collapsedLimit = 6;
  const visibleServices = expanded
    ? services
    : services.slice(0, collapsedLimit);
  const hiddenCount = Math.max(0, services.length - collapsedLimit);

  return (
    <div
      className="mt-3 cursor-pointer rounded-xl border border-slate-300 bg-slate-100/90 p-3 transition-colors hover:bg-slate-200/70 dark:border-slate-600 dark:bg-slate-800/70 dark:hover:bg-slate-800"
      onClick={(event) => {
        event.stopPropagation();
        onOpenItems();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenItems();
        }
      }}
    >
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        Leistungen · {services.length}
      </div>
      <div
        ref={listRef}
        className="grid gap-x-8 gap-y-1"
        style={{
          gridTemplateColumns: useTwoColumns
            ? "repeat(2, minmax(0, 1fr))"
            : "minmax(0, 1fr)",
        }}
      >
        {visibleServices.map((service, serviceIndex) => (
          <div
            key={`${offerId}:responsive-service:${serviceIndex}`}
            className="flex min-w-0 items-start gap-2 text-sm"
          >
            <span className="mt-[0.45rem] h-2 w-2 shrink-0 rounded-full bg-emerald-500/80" />
            <span className="min-w-0 flex-1 break-words leading-snug">
              {service.name}
            </span>
            <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
              {service.amountLabel}
            </span>
          </div>
        ))}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggle();
          }}
          className="mt-2 flex w-full items-center justify-center rounded-lg border border-blue-200 bg-blue-50/60 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 active:scale-[0.99]"
        >
          {expanded
            ? "Weniger Leistungen anzeigen"
            : `+ ${hiddenCount} weitere Leistungen`}
        </button>
      )}
    </div>
  );
}

export default function AngebotePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("Alle");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name" | "amount">(
    "newest",
  );
  const [visibleCount, setVisibleCount] = useState(30);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editOfferId, setEditOfferId] = useState<string | null>(null);
  const [editingOfferCustomer, setEditingOfferCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState({
    customerId: "",
    offerDate: new Date().toISOString().split("T")[0],
    validDays: "14",
    pdfTitle: "",
    notes: "",
    status: "Entwurf",
  });
  const historicalOfferCustomerLocked = Boolean(
    editOfferId && isHistoricalOfferStatus(form.status),
  );
  const dialogOfferCustomer =
    historicalOfferCustomerLocked && editingOfferCustomer
      ? editingOfferCustomer
      : form.customerId
        ? customers.find((customer) => customer.id === form.customerId) || null
        : null;
  const getEmptyItem = (): OfferItem => ({
    description: "",
    quantity: "",
    unit: "",
    unitPrice: "",
  });

  const [items, setItems] = useState<OfferItem[]>([getEmptyItem()]);
  const [serviceOverviewOpen, setServiceOverviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [fromOrderId, setFromOrderId] = useState<string | null>(null);
  const [vatRate, setVatRate] = useState(8.1);
  const [defaultVatRate, setDefaultVatRate] = useState(8.1);
  const [currency, setCurrency] = useState<"CHF" | "EUR">("CHF");
  const [defaultCurrency, setDefaultCurrency] = useState<"CHF" | "EUR">("CHF");
  // Stage M.2: Business WhatsApp intake number used as recipient for
  // "PDF an WhatsApp senden". NEVER use Customer.phone for this feature.
  const [businessWhatsappNumber, setBusinessWhatsappNumber] = useState<
    string | null
  >(null);
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);

  // New/edit customer inline
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [newCust, setNewCust] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    plz: "",
    city: "",
    country: "CH",
  });
  const [savingCust, setSavingCust] = useState(false);
  const [dupCheckOpen, setDupCheckOpen] = useState(false);
  const [serviceActionMenuIndex, setServiceActionMenuIndex] = useState<number | null>(null);
  const [expandedItemIndex, setExpandedItemIndex] = useState<number | null>(null);
  const [activeMobileTooltip, setActiveMobileTooltip] = useState<OfferMobileTooltipState | null>(null);
  const offerMobileInfoAutoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearOfferMobileInfoAutoCloseV17_90L175 = () => {
    if (offerMobileInfoAutoCloseTimerRef.current) {
      clearTimeout(offerMobileInfoAutoCloseTimerRef.current);
      offerMobileInfoAutoCloseTimerRef.current = null;
    }
  };
  const scheduleOfferMobileInfoAutoCloseV17_90L175 = () => {
    clearOfferMobileInfoAutoCloseV17_90L175();
    if (!activeMobileTooltip || activeMobileTooltip.kind === "service_review") return;
    offerMobileInfoAutoCloseTimerRef.current = setTimeout(() => setActiveMobileTooltip(null), 3000);
  };
  useEffect(() => {
    if (!activeMobileTooltip || activeMobileTooltip.kind === "service_review") {
      clearOfferMobileInfoAutoCloseV17_90L175();
      return;
    }
    scheduleOfferMobileInfoAutoCloseV17_90L175();
    return clearOfferMobileInfoAutoCloseV17_90L175;
  }, [activeMobileTooltip?.key]);
  const [activeMobileReviewSiteKey, setActiveMobileReviewSiteKey] = useState<string | null>(null);
  const [expandedMobileServiceCards, setExpandedMobileServiceCards] = useState<Set<string>>(new Set());
  const [expandedOfferCardIds, setExpandedOfferCardIds] = useState<Set<string>>(new Set());
  const [offerCardExpansionRestored, setOfferCardExpansionRestored] = useState(false);
  const [offerCardInitialStateApplied, setOfferCardInitialStateApplied] = useState(false);

  const [useTouchChipPopovers, setUseTouchChipPopovers] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(pointer: coarse)");
    const update = () => setUseTouchChipPopovers(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let restored = false;
    try {
      const stored = window.localStorage.getItem(
        "smartflow:angebote:expanded-card-ids:v1",
      );
      if (stored !== null) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setExpandedOfferCardIds(
            new Set(
              parsed.filter(
                (value: unknown): value is string => typeof value === "string",
              ),
            ),
          );
          restored = true;
        }
      }
    } catch {
      window.localStorage.removeItem(
        "smartflow:angebote:expanded-card-ids:v1",
      );
    }
    setOfferCardInitialStateApplied(restored);
    setOfferCardExpansionRestored(true);
  }, []);

  const toggleMobileServiceCard = (id: string) => {
    setExpandedMobileServiceCards((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleOfferCard = (id: string) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227));
    }
    setActiveMobileTooltip(null);
    setExpandedOfferCardIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const offerCardIds = offers.map((offer) => offer.id);
  const offerCardIdsKey = offerCardIds.join("\u241f");

  useEffect(() => {
    if (
      !offerCardExpansionRestored ||
      offerCardInitialStateApplied ||
      offerCardIds.length === 0
    )
      return;
    setExpandedOfferCardIds(new Set(offerCardIds));
    setOfferCardInitialStateApplied(true);
  }, [
    offerCardExpansionRestored,
    offerCardInitialStateApplied,
    offerCardIdsKey,
  ]);

  useEffect(() => {
    if (
      !offerCardExpansionRestored ||
      !offerCardInitialStateApplied ||
      typeof window === "undefined"
    )
      return;
    try {
      window.localStorage.setItem(
        "smartflow:angebote:expanded-card-ids:v1",
        JSON.stringify(Array.from(expandedOfferCardIds)),
      );
    } catch {
      // Local storage can be unavailable in strict/private browser modes.
    }
  }, [
    offerCardExpansionRestored,
    offerCardInitialStateApplied,
    expandedOfferCardIds,
  ]);

  const allOfferCardsExpanded =
    offerCardIds.length > 0 &&
    offerCardIds.every((id) => expandedOfferCardIds.has(id));

  const toggleAllOfferCards = () => {
    setExpandedOfferCardIds((current) => {
      const next = new Set(current);
      offerCardIds.forEach((id) => {
        if (allOfferCardsExpanded) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  };

  useEffect(() => {
    if (
      !activeMobileTooltip ||
      activeMobileTooltip.kind !== "service_review" ||
      typeof document === "undefined"
    )
      return;
    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, [activeMobileTooltip]);
  const [catalogDecision, setCatalogDecision] = useState<OfferCatalogDecision | null>(null);
  const [catalogDecisionSaving, setCatalogDecisionSaving] = useState(false);

  // Stage E (deterministic chip flow): pending customerId waiting for the
  // dialog to mount before opening the customer-edit section. Set by the chip
  // shortcut in list cards via openEditOffer({openCustomerSection:true}).
  const [pendingOpenCustomerEditor, setPendingOpenCustomerEditor] = useState<
    string | null
  >(null);
  const customerEditorRef = useRef<HTMLDivElement | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    action: () => Promise<void>;
  } | null>(null);
  const [revertingOfferId, setRevertingOfferId] = useState<string | null>(null);

  // Android/browser back: close the edit dialog FIRST instead of jumping to the
  // previously visited module. Safe version — see lib/use-dialog-back-guard.ts.
  useDialogBackGuard(dialogOpen, () => setDialogOpen(false));

  // Linked order data (for communication block)
  const [linkedOrderData, setLinkedOrderData] = useState<{
    notes?: string | null;
    specialNotes?: string | null;
    needsReview?: boolean;
    mediaUrl?: string | null;
    mediaType?: string | null;
    imageUrls?: string[];
    thumbnailUrls?: string[];
    audioTranscript?: string | null;
    audioDurationSec?: number | null;
    audioTranscriptionStatus?: string | null;
    hinweisLevel?: string | null;
    description?: string | null;
  } | null>(null);

  const [linkedOrderMessages, setLinkedOrderMessages] = useState<
    CommunicationData[]
  >([]);

  const [executionSites, setExecutionSites] = useState<OfferExecutionSite[]>(
    [],
  );
  const [expandedOfferSiteKeys, setExpandedOfferSiteKeys] = useState<Set<string>>(new Set());
  const [editingOfferSiteKey, setEditingOfferSiteKey] = useState<string | null>(null);
  const [newOfferItemSiteKey, setNewOfferItemSiteKey] = useState<string>("");
  const [editingExecutionAddress, setEditingExecutionAddress] = useState(false);
  const [executionAddressEditSnapshot, setExecutionAddressEditSnapshot] =
    useState("");
  const [selectedChipDetail, setSelectedChipDetail] = useState<string | null>(
    null,
  );
  const executionAddressRef = useRef<HTMLDivElement | null>(null);
  const serviceItemsRef = useRef<HTMLDivElement | null>(null);
  const offerDetailsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editingExecutionAddress) return;
    setExecutionAddressEditSnapshot(
      serializeOfferExecutionSitesForEdit(executionSites),
    );
    // Snapshot only when the editor changes from closed to open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingExecutionAddress]);

  // Auto-fill customer data from order notes when dialog opens
  const autoFillCustomer = async (customerId: string) => {
    if (!customerId) return;
    try {
      const res = await fetch(`/api/customers/${customerId}/auto-fill`, {
        method: "POST",
      });
      if (res.ok) {
        const updated = await res.json();
        setCustomers((prev) => {
          const exists = prev.some((c) => c.id === updated.id);
          if (exists)
            return prev.map((c) =>
              c.id === updated.id ? { ...c, ...updated } : c,
            );
          return [...prev, updated];
        });
      }
    } catch {}
  };

  // Block D: open the "Kunde bearbeiten" sheet for the currently-selected customer.
  // Used both by the inline ✏️ button and by clicking the customer summary box.
  // Optional `customerIdOverride` lets callers (e.g. the list-card chip
  // shortcut) pass a customer id directly without first relying on the
  // form state being flushed (useful when called immediately after
  // `openEditOffer()` because React state updates batch).
  // Optional `noteOverride` is the linked-order's notes used for merge.
  const openCustomerEditor = async (
    customerIdOverride?: string,
    noteOverride?: string | null,
  ) => {
    if (historicalOfferCustomerLocked) {
      toast.error(
        "Gesendete oder abgelehnte Angebote behalten den historischen Kundenstand. Setze das Angebot zuerst auf Entwurf.",
      );
      return;
    }
    const targetId = customerIdOverride || form.customerId;
    if (!targetId) return;
    let freshCust: Customer | null =
      customers.find((c: Customer) => c.id === targetId) || null;
    try {
      const res = await fetch(`/api/customers/${targetId}`);
      if (res.ok) {
        const fetched = await res.json();
        if (fetched && fetched.id) {
          freshCust = fetched;
          setCustomers((prev) =>
            prev.map((c) => (c.id === fetched.id ? { ...c, ...fetched } : c)),
          );
        }
      }
    } catch {}
    if (freshCust) {
      const noteSource =
        noteOverride !== undefined ? noteOverride : linkedOrderData?.notes;
      // Use blank form as merge base — prevents stale data from previously viewed records leaking in
      const blankForm = {
        name: "",
        phone: "",
        email: "",
        address: "",
        plz: "",
        city: "",
        country: "CH",
      };
      const merged = mergeCustomerIntoForm(
        blankForm,
        freshCust as any,
        noteSource,
      );
      setNewCust(merged);
    }
    setEditingCustomer(true);
    setShowNewCustomer(true);
  };

  // Save customer (update or create — merge goes via Sheet)
  const saveCustomer = async () => {
    if (historicalOfferCustomerLocked) {
      toast.error(
        "Historische Angebotsdaten können nicht über dieses Dokument geändert werden. Setze das Angebot zuerst auf Entwurf.",
      );
      return;
    }
    if (!newCust.name.trim()) {
      toast.error("Name erforderlich");
      return;
    }
    setSavingCust(true);
    try {
      if (editingCustomer && form.customerId) {
        // Phase 2f: compute fieldsToClear = fields user intentionally emptied.
        const dbCust = customers.find(
          (c: Customer) => c.id === form.customerId,
        );
        const fieldsToClear: string[] = [];
        if (dbCust) {
          (
            ["name", "phone", "email", "address", "plz", "city"] as const
          ).forEach((k) => {
            const was = (dbCust as any)[k];
            const now = (newCust as any)[k];
            if (was && String(was).trim() && !String(now || "").trim())
              fieldsToClear.push(k);
          });
        }
        const res = await fetch(`/api/customers/${form.customerId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...newCust, fieldsToClear }),
        });
        if (res.ok) {
          const updated = await res.json();
          setCustomers((prev) => {
            const e = prev.some((c) => c.id === updated.id);
            return e
              ? prev.map((c) =>
                  c.id === updated.id ? { ...c, ...updated } : c,
                )
              : [...prev, updated];
          });
          // Also update nested customer in offers so list/cards refresh immediately
          setOffers((prev) =>
            prev.map((o) =>
              o.customerId === updated.id &&
              !isHistoricalOfferStatus(o.status)
                ? { ...o, customer: { ...o.customer, ...updated } }
                : o,
            ),
          );
          setForm((f) => ({ ...f, customerId: updated.id }));
          toast.success(`Kunde "${updated.name}" aktualisiert!`);
        } else {
          const err = await res.json().catch(() => ({}) as any);
          if (err?.reason === "would_clear_existing_value")
            toast.error(err?.error || "Feld kann nicht geleert werden.");
          else toast.error("Fehler beim Aktualisieren");
          return;
        }
      } else {
        const res = await fetch("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newCust),
        });
        if (res.ok) {
          const created = await res.json();
          setCustomers((prev) => [...prev, created]);
          setForm((f) => ({ ...f, customerId: created.id }));
          toast.success("Neuer Kunde erstellt – eigene ID wurde vergeben");
        } else toast.error("Fehler beim Anlegen");
      }
      setShowNewCustomer(false);
      setEditingCustomer(false);
      setNewCust({
        name: "",
        phone: "",
        email: "",
        address: "",
        plz: "",
        city: "",
        country: "CH",
      });
    } catch {
      toast.error("Fehler");
    } finally {
      setSavingCust(false);
    }
  };

  // Media playback
  const [mediaDialogOpen, setMediaDialogOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string | null>(null);
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [galleryIdx, setGalleryIdx] = useState(0);
  // Native action menus avoid a full offer-list render on every open/close.
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      document
        .querySelectorAll<HTMLDetailsElement>(
          "details[data-offer-action-menu][open]",
        )
        .forEach((menu) => {
          if (!target || !menu.contains(target)) menu.open = false;
        });
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  useEffect(() => {
    if (serviceActionMenuIndex === null) return;
    const closeMenu = () => setServiceActionMenuIndex(null);
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, [serviceActionMenuIndex]);

  const resolveS3Url = async (path: string): Promise<string> => {
    try {
      const res = await fetch("/api/upload/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cloud_storage_path: path, isPublic: false }),
      });
      const data = await res.json();
      return data.url || path;
    } catch {
      return path;
    }
  };

  const openMedia = async (cloudPath: string, type: string) => {
    if (type === "audio") {
      const url = await resolveS3Url(cloudPath);
      setMediaUrl(url);
      setMediaType("audio");
      setGalleryUrls([]);
      setMediaDialogOpen(true);
      return;
    }
    const url = await resolveS3Url(cloudPath);
    setGalleryUrls([url]);
    setGalleryIdx(0);
    setMediaType("image");
    setMediaUrl(null);
    setMediaDialogOpen(true);
  };

  const openImageGallery = async (paths: string[]) => {
    const resolved = await Promise.all(paths.map((p) => resolveS3Url(p)));
    setGalleryUrls(resolved);
    setGalleryIdx(0);
    setMediaType("image");
    setMediaUrl(null);
    setMediaDialogOpen(true);
  };

  const load = async (options?: { background?: boolean }) => {
    const background = options?.background === true;
    if (!background) setLoading(true);
    setLoadError(null);
    const {
      results: [off, cust, svc, settings],
      errors,
    } = await fetchAllJSON<[any[], any[], any[], any]>([
      { url: "/api/offers", fallback: [] },
      { url: "/api/customers", fallback: [] },
      { url: "/api/services", fallback: [] },
      { url: "/api/settings", fallback: null },
    ]);
    // If most critical endpoints failed, show error state
    if (errors.length >= 2) {
      setLoadError(errors);
      if (!background) setLoading(false);
      return;
    }
    // Merge customers from offers without replacing a complete master name
    // with an abbreviated list payload such as "R".
    const custMap = new Map<string, any>();
    const customerNumberMap = new Map<string, string>();
    const normalizeCustomerNumber = (value: unknown) =>
      String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const mergeCustomerRecord = (candidate: any) => {
      if (!candidate) return;
      const id = String(candidate.id || "").trim();
      const numberKey = normalizeCustomerNumber(candidate.customerNumber);
      const mappedId = numberKey ? customerNumberMap.get(numberKey) : "";
      const targetId = id || mappedId || numberKey;
      if (!targetId) return;
      const existing = custMap.get(targetId) || (mappedId ? custMap.get(mappedId) : null);
      if (!existing) {
        custMap.set(targetId, candidate);
        if (numberKey) customerNumberMap.set(numberKey, targetId);
        return;
      }
      const bestName = pickBestOfferCustomerName(existing.name, candidate.name);
      custMap.set(targetId, { ...candidate, ...existing, name: bestName });
      if (numberKey) customerNumberMap.set(numberKey, targetId);
    };
    (cust ?? []).forEach(mergeCustomerRecord);
    (off ?? []).forEach((o: any) => mergeCustomerRecord(o.customer));
    setOffers(off ?? []);
    setCustomers(Array.from(custMap.values()) as any);
    setServices(svc ?? []);
    // Set default VAT rate from settings
    if (settings) {
      const settingsCurrency = settings.currency === "EUR" ? "EUR" : "CHF";
      setDefaultCurrency(settingsCurrency);

      if (!dialogOpen && !editOfferId) {
        setCurrency(settingsCurrency);
      }
      if (settings.mwstAktiv && settings.mwstSatz != null) {
        setDefaultVatRate(Number(settings.mwstSatz));
      } else if (settings.mwstAktiv === false) {
        setDefaultVatRate(0);
      }
      // Stage M.3: resolve the BUSINESS WhatsApp recipient for
      // "PDF an WhatsApp senden". The PDF goes to the business owner's
      // own inbox so they can review/forward.
      //   1) Prefer the dedicated `whatsappIntakeNumber` (if explicitly
      //      configured by the user).
      //   2) Fall back to `telefon` — the PRIMARY business number that
      //      the inbound WhatsApp/Twilio webhook (lib/phone-resolver.ts)
      //      already matches against. If inbound works, this number is
      //      WhatsApp-capable by definition.
      //   STRICT: NEVER fall back to `telefon2` (second number); NEVER
      //   use Customer.phone.
      setBusinessWhatsappNumber(
        settings.whatsappIntakeNumber || settings.telefon || null,
      );
      if (settings.whatsappEnabled === false) setWhatsappEnabled(false);
    }
    if (errors.length > 0)
      toast.error("Einige Daten konnten nicht vollständig geladen werden");
    if (!background) setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const refreshVisibleList = () => {
      if (!dialogOpen) void load({ background: true });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshVisibleList();
    };
    window.addEventListener("focus", refreshVisibleList);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", refreshVisibleList);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen]);

  // Auto-open new offer dialog when navigated with ?new=1
  useEffect(() => {
    const isNew = searchParams?.get("new") === "1";
    const custId = searchParams?.get("customerId");
    if (isNew) {
      setEditOfferId(null);
      setEditingOfferCustomer(null);
      setVatRate(defaultVatRate);
      setCurrency(defaultCurrency);
      const newForm = {
        customerId: custId || "",
        offerDate: new Date().toISOString().split("T")[0],
        validDays: "14",
        pdfTitle: "",
        notes: "",
        status: "Entwurf",
      };
      setForm(newForm);
      setItems([getEmptyItem()]);
      setLinkedOrderData(null);
      setExecutionSites([]);
      setEditingExecutionAddress(false);
      setSelectedChipDetail(null);
      setShowNewCustomer(false);
      setEditingCustomer(false);
      setDialogOpen(true);
      router.replace("/angebote", { scroll: false });
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Package F: auto-open edit dialog when navigated with ?edit=<id>.
  // This is the SINGLE source-of-truth entry point for direct-open from the
  // customer detail page (or any deep link). It fetches the exact target offer
  // by id via /api/offers/<id> — so it works even if the offer is hidden by
  // the default 'Aktive' filter, not yet loaded into the in-memory list, or
  // the list failed to load. Never shows an unrelated filtered list state.
  useEffect(() => {
    const editId = searchParams?.get("edit");
    if (!editId || dialogOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/offers/${editId}`);
        if (cancelled) return;
        if (!res.ok) {
          toast.error(
            res.status === 404
              ? "Angebot nicht gefunden"
              : "Fehler beim Öffnen",
          );
          router.replace("/angebote", { scroll: false });
          return;
        }
        const off = await res.json();
        if (cancelled) return;
        openEditOffer(off);
        router.replace("/angebote", { scroll: false });
      } catch {
        if (!cancelled) {
          toast.error("Fehler beim Öffnen");
          router.replace("/angebote", { scroll: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // fromOrder auto-open removed — small dropdown now creates directly via API

  const focusNewestOfferItem = () => {
    requestAnimationFrame(() => {
      serviceItemsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      window.setTimeout(() => {
        serviceItemsRef.current
          ?.querySelector<HTMLInputElement>(
            '[data-service-item-index="0"] input',
          )
          ?.focus();
      }, 180);
    });
  };

  const addItem = () => {
    const groups = groupOfferItemsByExecutionSite(items || [], executionSites);
    // V17.90L135J: Bei mehreren Arbeitsorten wird der Arbeitsort erst
    // in der neu geöffneten Leistungsposition ausgewählt. Das permanente
    // Dropdown in der Kopfzeile entfällt dadurch.
    const requestedKey =
      executionSites.length > 1
        ? null
        : newOfferItemSiteKey ||
          editingOfferSiteKey ||
          Array.from(expandedOfferSiteKeys)[0] ||
          groups[0]?.key ||
          null;

    const targetSite =
      groups.find((group) => group.key === requestedKey)?.site ||
      executionSites.find(
        (site) => offerGroupKeyForSite(site) === requestedKey,
      ) ||
      null;
    setItems((current) => [
      { ...getEmptyItem(), ...(targetSite || {}) },
      ...current,
    ]);
    if (requestedKey)
      setExpandedOfferSiteKeys((current) =>
        new Set([...current, requestedKey]),
      );
    setExpandedItemIndex(0);
    setServiceActionMenuIndex(null);
    focusNewestOfferItem();
  };
  const removeItem = (i: number) =>
    setItems(items?.filter((_: any, idx: number) => idx !== i) ?? []);
  const updateItem = (i: number, field: string, value: string) => {
    const updated = [...(items ?? [])];
    if (updated[i]) (updated[i] as any)[field] = value;
    setItems(updated);
  };

  const assignOfferItemToSite = (index: number, siteKey: string) => {
    const site = executionSites.find(
      (candidate) => offerGroupKeyForSite(candidate) === siteKey,
    );
    if (!site) return;
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              siteName: site.siteName || null,
              siteAddress: site.siteAddress || null,
              sitePlz: site.sitePlz || null,
              siteCity: site.siteCity || null,
              siteNote: site.siteNote || null,
              sourceOrderId: site.sourceOrderId || null,
            }
          : item,
      ),
    );
    setNewOfferItemSiteKey(siteKey);
    setExpandedOfferSiteKeys((current) => new Set([...current, siteKey]));
  };

  const addServiceItem = (svc: any) => {
    setItems((current) => [
      {
        description: svc?.name ?? "",
        quantity: "",
        unit: compactOfferValue(svc?.unit) || "",
        unitPrice: String(svc?.defaultPrice ?? 0),
      },
      ...current,
    ]);
    setExpandedItemIndex(0);
    setServiceActionMenuIndex(null);
    focusNewestOfferItem();
  };

  const onItemServiceSelect = (
    idx: number,
    name: string,
    svcOpt?: ServiceOption,
  ) => {
    const svc = svcOpt ?? services?.find((s: any) => s.name === name);
    if (svc) {
      updateItem(idx, "description", svc.name);
      updateItem(idx, "unitPrice", String(svc.defaultPrice ?? 0));
      updateItem(idx, "unit", compactOfferValue(svc.unit));
    } else if (!name) {
      updateItem(idx, "description", "");
      updateItem(idx, "unitPrice", "");
      updateItem(idx, "quantity", "");
      updateItem(idx, "unit", "");
    } else {
      updateItem(idx, "description", name);
    }
  };

  const handleServiceCreated = (newSvc: ServiceOption) => {
    setServices((prev: any[]) => {
      const next = prev.filter(
        (service: any) =>
          service?.id !== (newSvc as any)?.id &&
          normalizeOfferHint(service?.name) !== normalizeOfferHint(newSvc?.name),
      );
      return [...next, newSvc].sort((a, b) =>
        (a?.name ?? "").localeCompare(b?.name ?? "", "de", {
          sensitivity: "base",
        }),
      );
    });
  };

  const saveOfferItemToServices = async (index: number) => {
    const item = items[index];
    if (!item?.description?.trim()) return;

    const name = item.description.trim().replace(/\s+/g, " ");
    const price = Number(item.unitPrice || 0);
    const quantity = Number(item.quantity || 0);
    const unit = String(item.unit || "").trim();

    if (price <= 0 || quantity <= 0 || !unit) {
      toast.error("Preis, Menge und Einheit zuerst prüfen");
      return;
    }

    const existing = (services || []).find(
      (service: any) =>
        normalizeOfferHint(service?.name) === normalizeOfferHint(name),
    );

    if (existing) {
      const sameUnit = String(existing?.unit || "").trim() === unit;
      const samePrice =
        Math.abs(Number(existing?.defaultPrice || 0) - price) < 0.001;
      if (sameUnit && samePrice) {
        onItemServiceSelect(index, existing.name, existing);
        setServiceActionMenuIndex(null);
        toast.success("Leistung ist bereits passend im Leistungskatalog");
        return;
      }

      setCatalogDecision({ index, existing, name, price, unit });
      setServiceActionMenuIndex(null);
      return;
    }

    try {
      const response = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, defaultPrice: price, unit }),
      });
      if (!response.ok) throw new Error("service_create_failed");
      const savedService: ServiceOption = await response.json();
      handleServiceCreated(savedService);
      onItemServiceSelect(index, savedService.name, savedService);
      setServiceActionMenuIndex(null);
      toast.success("Leistung wurde in den Leistungskatalog übernommen");
    } catch {
      toast.error("Leistung konnte nicht übernommen werden");
    }
  };

  const updateOfferCatalogFromDecision = async () => {
    if (!catalogDecision) return;
    setCatalogDecisionSaving(true);
    try {
      const response = await fetch("/api/services", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: catalogDecision.existing.id,
          name: catalogDecision.existing.name || catalogDecision.name,
          defaultPrice: catalogDecision.price,
          unit: catalogDecision.unit,
        }),
      });
      if (!response.ok) throw new Error("service_update_failed");
      const savedService: ServiceOption = await response.json();
      handleServiceCreated(savedService);
      onItemServiceSelect(
        catalogDecision.index,
        savedService.name,
        savedService,
      );
      setCatalogDecision(null);
      toast.success("Leistungskatalog wurde aktualisiert");
    } catch {
      toast.error("Leistungskatalog konnte nicht aktualisiert werden");
    } finally {
      setCatalogDecisionSaving(false);
    }
  };

  const subtotal =
    items?.reduce(
      (sum: number, item: OfferItem) =>
        sum + Number(item?.quantity ?? 0) * Number(item?.unitPrice ?? 0),
      0,
    ) ?? 0;
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;
  const parsedLinkedSpecialNotes = splitSpecialNotes(
    linkedOrderData?.specialNotes,
  );
  const linkedOfferCustomer = form.customerId
    ? customers.find((customer) => customer.id === form.customerId) || null
    : null;
  const linkedContactAction = buildOfferContactAction(
    linkedOrderData || ({} as CommunicationData),
    linkedOfferCustomer,
  );
  const linkedEditorOrdersV17_90L237 =
    linkedOrderMessages.length > 0
      ? (linkedOrderMessages as any[])
      : linkedOrderData
        ? ([linkedOrderData] as any[])
        : [];
  const linkedAppointmentLabelV17_90L237 = resolveOfferAppointmentLabelV17_90L237(
    linkedEditorOrdersV17_90L237,
    linkedOrderData,
  );
  const linkedInfoSummary = buildOfferInfoSummary(
    linkedOrderData || ({} as CommunicationData),
    parsedLinkedSpecialNotes,
    linkedAppointmentLabelV17_90L237,
    linkedContactAction,
    linkedEditorOrdersV17_90L237,
    items.map((item) => String(item?.description || "")),
  );
  const linkedSafetyWarnings = linkedInfoSummary.safety;
  const linkedPrimaryHints = linkedInfoSummary.primary;
  const linkedJobHints = uniqueOfferInfoLinesV17_66([
    ...linkedInfoSummary.additional,
    ...extractOfferParkingLinesV17_90L264(linkedEditorOrdersV17_90L237),
  ]);

  const updateExecutionSite = (
    index: number,
    field: keyof OfferExecutionSite,
    value: string,
  ) => {
    setExecutionSites((current) => {
      const next = [...current];
      const existing = next[index] || {};
      next[index] = {
        ...existing,
        [field]: value,
      };
      return next;
    });
  };

  const offerGroupKeyForSite = (site: OfferExecutionSite) =>
    `${site.sourceOrderId || ""}|${offerSiteKey(site)}`;

  const addExecutionSite = () => {
    const unfinishedSiteIndex = executionSites.findIndex(
      (site) =>
        !compactOfferValue(site.siteName) &&
        !compactOfferValue(site.siteAddress) &&
        !compactOfferValue(site.sitePlz) &&
        !compactOfferValue(site.siteCity),
    );
    if (unfinishedSiteIndex >= 0) {
      const unfinishedSite = executionSites[unfinishedSiteIndex];
      const unfinishedKey = offerGroupKeyForSite(unfinishedSite);
      setEditingOfferSiteKey(unfinishedKey);
      setNewOfferItemSiteKey(unfinishedKey);
      setExpandedOfferSiteKeys((current) =>
        new Set([...current, unfinishedKey]),
      );
      toast.info("Leeren Arbeitsort zuerst ausfüllen oder löschen.");
      return;
    }

    const site: OfferExecutionSite = {
      siteName: "",
      siteAddress: "",
      sitePlz: "",
      siteCity: "",
      siteNote: "",
      sourceOrderId: null,
    };
    const key = offerGroupKeyForSite(site);
    setExecutionSites((current) => [...current, site]);
    setItems((current) => [{ ...getEmptyItem(), ...site }, ...current]);
    setEditingExecutionAddress(true);
    setEditingOfferSiteKey(key);
    setNewOfferItemSiteKey(key);
    setExpandedOfferSiteKeys((current) => new Set([...current, key]));
    setExpandedItemIndex(0);
    focusNewestOfferItem();
  };

  const updateOfferGroupSite = (
    groupKey: string,
    field: keyof OfferExecutionSite,
    value: string,
  ) => {
    const siteIndex = executionSites.findIndex(
      (site) => offerGroupKeyForSite(site) === groupKey,
    );
    if (siteIndex < 0) return;
    const oldSite = executionSites[siteIndex];
    const nextSite = { ...oldSite, [field]: value };
    const nextKey = offerGroupKeyForSite(nextSite);
    updateExecutionSite(siteIndex, field, value);
    setItems((current) =>
      current.map((item) => {
        const belongs =
          offerGroupKeyForSite(item as OfferExecutionSite) === groupKey;
        return belongs ? { ...item, [field]: value || null } : item;
      }),
    );
    setEditingOfferSiteKey(nextKey);
    setExpandedOfferSiteKeys((current) => {
      const next = new Set(current);
      next.delete(groupKey);
      next.add(nextKey);
      return next;
    });
  };

  const removeOfferExecutionSite = (groupKey: string) => {
    const groups = groupOfferItemsByExecutionSite(items || [], executionSites);
    const group = groups.find((entry) => entry.key === groupKey);
    if (!group?.site) return;
    const hasRealItems = group.entries.some(({ item }) =>
      Boolean(
        compactOfferValue(item.description) ||
          Number(item.quantity || 0) > 0 ||
          Number(item.unitPrice || 0) > 0,
      ),
    );
    if (hasRealItems) {
      toast.error(
        "Arbeitsort kann nicht gelöscht werden: Leistungen sind noch zugeordnet.",
      );
      return;
    }

    setExecutionSites((current) =>
      current.filter((site) => offerGroupKeyForSite(site) !== groupKey),
    );
    setItems((current) =>
      current.filter(
        (item) => offerGroupKeyForSite(item as OfferExecutionSite) !== groupKey,
      ),
    );
    setExpandedOfferSiteKeys((current) => {
      const next = new Set(current);
      next.delete(groupKey);
      return next;
    });
    setEditingOfferSiteKey(null);
    setNewOfferItemSiteKey("");
  };

  const toggleAllOfferSites = () => {
    const groups = groupOfferItemsByExecutionSite(items || [], executionSites);
    setExpandedOfferSiteKeys((current) =>
      current.size === groups.length
        ? new Set()
        : new Set(groups.map((group) => group.key)),
    );
  };

  const toggleOfferExecutionAddressEditor = () => {
    if (executionSites.length === 0) return;
    if (!editingExecutionAddress) {
      setEditingExecutionAddress(true);
      return;
    }
    if (
      serializeOfferExecutionSitesForEdit(executionSites) !==
      executionAddressEditSnapshot
    ) {
      toast.info("Bitte Ausführungsadresse zuerst speichern.");
      return;
    }
    setEditingExecutionAddress(false);
  };

  const setExecutionAddressEnabled = (enabled: boolean) => {
    if (enabled) {
      setExecutionSites((current) =>
        current.length > 0
          ? current
          : [
              {
                siteName: "",
                siteAddress: "",
                sitePlz: "",
                siteCity: "",
                siteNote: "",
                sourceOrderId: fromOrderId || null,
              },
            ],
      );
      setEditingExecutionAddress(true);
      requestAnimationFrame(() =>
        executionAddressRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      );
      return;
    }

    setExecutionSites([]);
    setEditingExecutionAddress(false);
  };

  const openOfferSection = (
    off: Offer,
    section: "execution" | "items" | "details",
    detail?: string,
  ) => {
    openEditOffer(off);
    setSelectedChipDetail(detail || null);
    window.setTimeout(() => {
      const target =
        section === "execution"
          ? executionAddressRef.current
          : section === "items"
            ? serviceItemsRef.current
            : offerDetailsRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 160);
  };

  const toggleOfferMobileTooltip = (
    payload: OfferMobileTooltipState,
    event: any,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget?.getBoundingClientRect?.();
    const kind =
      payload.kind ||
      (payload.reviewSections && payload.reviewSections.length > 0
        ? "service_review"
        : "default");
    const nextPayload: OfferMobileTooltipState = {
      ...payload,
      kind,
      anchorRect: rect
        ? {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            height: rect.height,
          }
        : undefined,
    };
    setActiveMobileTooltip((current) =>
      current?.key === payload.key ? null : nextPayload,
    );
  };

  /**
   * Opens the offer edit dialog. With `opts.openCustomerSection: true`
   * the customer-edit panel is auto-expanded with fresh customer data —
   * used by the list-card "Kundendaten unvollständig" chip so the user
   * lands directly inside the editor with one tap.
   */
  const openEditOffer = (
    off: Offer,
    opts?: { openCustomerSection?: boolean },
  ) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227));
    }
    setActiveMobileTooltip(null);
    setEditOfferId(off.id);
    setEditingOfferCustomer(off.customer ? { ...off.customer } : null);
    setServiceOverviewOpen(false);
    setDupCheckOpen(false);
    setEditingExecutionAddress(false);
    setExpandedOfferSiteKeys(new Set());
    setEditingOfferSiteKey(null);
    setNewOfferItemSiteKey("");
    setSelectedChipDetail(null);
    setServiceActionMenuIndex(null);
    setExpandedItemIndex(null);
    setCatalogDecision(null);
    // Reset customer form to prevent stale data leaking between records
    setNewCust({
      name: "",
      phone: "",
      email: "",
      address: "",
      plz: "",
      city: "",
      country: "CH",
    });
    setVatRate(off.vatRate != null ? Number(off.vatRate) : defaultVatRate);
    setCurrency(
      off.currency === "EUR"
        ? "EUR"
        : off.currency === "CHF"
          ? "CHF"
          : defaultCurrency,
    );
    // Set linked order data for Original-Nachricht / Besonderheiten
    const lo = off.orders?.[0];
    setLinkedOrderMessages(((off.orders || []) as unknown) as CommunicationData[]);
    const offerExecutionSites = collectOfferExecutionSites(off);
    const singleExecutionSite =
      offerExecutionSites.length === 1 ? offerExecutionSites[0] : null;
    setExecutionSites(offerExecutionSites);
    if (lo)
      setLinkedOrderData({
        notes: lo.notes,
        specialNotes: lo.specialNotes,
        needsReview: lo.needsReview,
        mediaUrl: lo.mediaUrl,
        mediaType: lo.mediaType,
        imageUrls: lo.imageUrls,
        thumbnailUrls: lo.thumbnailUrls,
        audioTranscript: lo.audioTranscript,
        audioDurationSec: lo.audioDurationSec,
        audioTranscriptionStatus: lo.audioTranscriptionStatus,
        hinweisLevel: lo.hinweisLevel,
        description: lo.description,
      });
    else setLinkedOrderData(null);
    // Strip forwarded customer message from the customer-visible PDF text.
    // Existing offers without their own text receive a safe, editable suggestion
    // from the linked order summary — never from the raw customer message.
    const decodedPdfMeta = decodeOfferPdfMeta(off.notes);
    const hasEncodedPdfMeta = String(off.notes || "").startsWith(
      OFFER_PDF_META_PREFIX,
    );
    const cleanNotes = hasEncodedPdfMeta
      ? decodedPdfMeta.text
      : cleanOfferPdfTextForEditor(off, lo);
    setForm({
      customerId: off.customerId ?? "",
      offerDate: off.offerDate
        ? new Date(off.offerDate).toISOString().split("T")[0]
        : "",
      validDays: getOfferValidDays(off),
      pdfTitle: decodedPdfMeta.title,
      notes: cleanNotes,
      status: off.status ?? "Entwurf",
    });
    if (off.items && off.items.length > 0) {
      setItems(
        off.items.map((i: any) => ({
          description: i.description ?? "",
          quantity: String(i.quantity ?? 0),
          unit: i.unit ?? "Stunde",
          unitPrice: String(i.unitPrice ?? 0),
          siteName: i.siteName || singleExecutionSite?.siteName || null,
          siteAddress:
            i.siteAddress || singleExecutionSite?.siteAddress || null,
          sitePlz: i.sitePlz || singleExecutionSite?.sitePlz || null,
          siteCity: i.siteCity || singleExecutionSite?.siteCity || null,
          siteNote: i.siteNote || singleExecutionSite?.siteNote || null,
          sourceOrderId:
            i.sourceOrderId || singleExecutionSite?.sourceOrderId || null,
        })),
      );
    } else {
      setItems([getEmptyItem()]);
    }
    if (opts?.openCustomerSection && off.customerId) {
      // Stage E (deterministic flow): mark a pending request; the effect below
      // picks it up once dialog is open AND form.customerId === pendingId.
      // This avoids the React batching race where the async fetch in
      // openCustomerEditor could complete before the dialog had even mounted.
      setPendingOpenCustomerEditor(off.customerId);
      // We intentionally DO NOT reset showNewCustomer / editingCustomer here.
    } else {
      setShowNewCustomer(false);
      setEditingCustomer(false);
      setPendingOpenCustomerEditor(null);
    }
    setDialogOpen(true);
    // Historische Angebote dürfen den zentralen Kundenstamm weder nachladen
    // noch durch Auto-Fill verändern. Entwürfe bleiben live verknüpft.
    if (off.customerId && !isHistoricalOfferStatus(off.status))
      autoFillCustomer(off.customerId);
  };

  // Stage E (deterministic chip flow): runs AFTER the dialog has actually
  // opened AND the form is populated. Cannot be raced by openEditOffer's
  // own state resets.
  useEffect(() => {
    if (!pendingOpenCustomerEditor) return;
    if (!dialogOpen) return;
    if (form.customerId !== pendingOpenCustomerEditor) return;
    const targetId = pendingOpenCustomerEditor;
    let cancelled = false;
    (async () => {
      try {
        let freshCust: Customer | null =
          customers.find((c: Customer) => c.id === targetId) || null;
        try {
          const res = await fetch(`/api/customers/${targetId}`);
          if (res.ok) {
            const fetched = await res.json();
            if (fetched && fetched.id) {
              freshCust = fetched;
              if (!cancelled) {
                setCustomers((prev) =>
                  prev.map((c) =>
                    c.id === fetched.id ? { ...c, ...fetched } : c,
                  ),
                );
              }
            }
          }
        } catch {}
        if (cancelled) return;
        if (freshCust) {
          const noteSource = linkedOrderData?.notes ?? null;
          const merged = mergeCustomerIntoForm(
            {
              name: "",
              phone: "",
              email: "",
              address: "",
              plz: "",
              city: "",
              country: "CH",
            },
            freshCust as any,
            noteSource,
          );
          setNewCust(merged);
        }
        setEditingCustomer(true);
        setShowNewCustomer(true);
        setPendingOpenCustomerEditor(null);
        requestAnimationFrame(() => {
          customerEditorRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        });
      } catch {
        if (!cancelled) setPendingOpenCustomerEditor(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenCustomerEditor, dialogOpen, form.customerId]);

  useEffect(() => {
    if (!dialogOpen) setPendingOpenCustomerEditor(null);
  }, [dialogOpen]);

  const openNewOffer = () => {
    setEditOfferId(null);
    setServiceOverviewOpen(false);
    setVatRate(defaultVatRate);
    setCurrency(defaultCurrency);
    setForm({
      customerId: "",
      offerDate: new Date().toISOString().split("T")[0],
      validDays: "14",
      pdfTitle: "",
      notes: "",
      status: "Entwurf",
    });
    setItems([getEmptyItem()]);
    setLinkedOrderData(null);
    setLinkedOrderMessages([]);
    setExecutionSites([]);
    setExpandedOfferSiteKeys(new Set());
    setEditingOfferSiteKey(null);
    setNewOfferItemSiteKey("");
    setEditingExecutionAddress(false);
    setSelectedChipDetail(null);
    setServiceActionMenuIndex(null);
    setExpandedItemIndex(null);
    setCatalogDecision(null);
    setShowNewCustomer(false);
    setEditingCustomer(false);
    setDialogOpen(true);
  };

  // Core save — returns saved offer or null
  const saveOffer = async (): Promise<any | null> => {
    if (!form?.customerId) {
      toast.error("Bitte Kunde wählen");
      return null;
    }
    if (!items?.length || !items[0]?.description?.trim()) {
      toast.error("Mindestens eine Position");
      return null;
    }

    const itemsForSave = applyExecutionSitesToOfferItems(items, executionSites);

    if (editOfferId) {
      const res = await fetch(`/api/offers/${editOfferId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          notes: encodeOfferPdfMeta(form.pdfTitle, form.notes),
          items: itemsForSave,
          vatRate,
          currency,
        }),
      });
      if (res.ok) return await res.json();
      toast.error("Fehler beim Speichern");
      return null;
    } else {
      const payload: any = {
        ...form,
        notes: encodeOfferPdfMeta(form.pdfTitle, form.notes),
        items: itemsForSave,
        vatRate,
        currency,
      };
      if (fromOrderId) payload.orderIds = [fromOrderId];
      const res = await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return await res.json();
      toast.error("Fehler beim Erstellen");
      return null;
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveOffer();
      if (saved) {
        toast.success(
          editOfferId
            ? "Angebot aktualisiert"
            : `Angebot ${saved?.offerNumber ?? ""} erstellt`,
        );
        if (!editOfferId && saved?.id) setEditOfferId(saved.id);
        setFromOrderId(null);
        await load();
      }
    } catch {
      toast.error("Fehler");
    } finally {
      setSaving(false);
    }
  };

  const saveOfferExecutionAddress = async () => {
    setSaving(true);
    try {
      const saved = await saveOffer();
      if (!saved) return;
      if (!editOfferId && saved?.id) setEditOfferId(saved.id);
      setFromOrderId(null);
      setExecutionAddressEditSnapshot(
        serializeOfferExecutionSitesForEdit(executionSites),
      );
      setEditingExecutionAddress(false);
      toast.success("Ausführungsadresse gespeichert");
      await load();
    } catch {
      toast.error("Ausführungsadresse konnte nicht gespeichert werden");
    } finally {
      setSaving(false);
    }
  };

  const saveAndClose = async () => {
    setSaving(true);
    try {
      const saved = await saveOffer();
      if (saved) {
        toast.success(
          editOfferId
            ? "Angebot aktualisiert"
            : `Angebot ${saved?.offerNumber ?? ""} erstellt`,
        );
        setDialogOpen(false);
        setFromOrderId(null);
        await load();
      }
    } catch {
      toast.error("Fehler");
    } finally {
      setSaving(false);
    }
  };

  const getOfferToInvoiceBlockersV17_90L174 = (
    entries: Array<{
      description?: string | null;
      quantity?: string | number | null;
      unit?: string | null;
      unitPrice?: string | number | null;
    }>,
  ) => {
    const blockers: string[] = [];
    if (!entries.length) blockers.push("Keine Leistungen vorhanden");
    entries.forEach((entry, index) => {
      const label = String(entry.description || "").trim() || `Position ${index + 1}`;
      if (!String(entry.description || "").trim()) blockers.push(`${label}: Leistung fehlt`);
      if (!String(entry.unit || "").trim() || /^(?:prüfen|pruefen)$/i.test(String(entry.unit || "").trim()))
        blockers.push(`${label}: Einheit fehlt`);
      if (Number(entry.quantity || 0) <= 0) blockers.push(`${label}: Menge fehlt`);
      if (Number(entry.unitPrice || 0) <= 0) blockers.push(`${label}: Preis fehlt`);
    });
    return Array.from(new Set(blockers));
  };

  // Save + Create Invoice → navigate to /rechnungen
  const saveAndCreateInvoice = async () => {
    setSaving(true);
    try {
      const saved = await saveOffer();
      if (!saved) {
        setSaving(false);
        return;
      }
      toast.success(
        editOfferId
          ? "Angebot aktualisiert"
          : `Angebot ${saved?.offerNumber ?? ""} erstellt`,
      );

      // Determine offer ID (could be new or existing)
      const offerId = saved.id || editOfferId;
      // Get items from saved response or current form
      const offerItems =
        saved.items && saved.items.length > 0
          ? saved.items.map((i: any) => ({
              description: i.description ?? "",
              quantity: String(i.quantity ?? 0),
              unit: i.unit ?? "",
              unitPrice: String(i.unitPrice ?? 0),
              siteName: i.siteName || null,
              siteAddress: i.siteAddress || null,
              sitePlz: i.sitePlz || null,
              siteCity: i.siteCity || null,
              siteNote: i.siteNote || null,
              sourceOrderId: i.sourceOrderId || null,
            }))
          : items;
      const conversionBlockers = getOfferToInvoiceBlockersV17_90L174(offerItems);
      if (conversionBlockers.length > 0) {
        toast.error(`Rechnung nicht möglich: ${conversionBlockers.slice(0, 3).join(", ")}`);
        setSaving(false);
        return;
      }

      // Carry over linked order IDs so intake time & communication data are preserved
      const linkedOrderIds =
        saved.orders?.map((o: any) => o.id).filter(Boolean) ?? [];
      // Also check current offer's linked orders from the list state
      const currentOffer = offers.find((o) => o.id === offerId);
      const allOrderIds =
        linkedOrderIds.length > 0
          ? linkedOrderIds
          : (currentOffer?.orders?.map((o) => o.id).filter(Boolean) ?? []);

      // Create invoice from offer data
      const invRes = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: saved.customerId || form.customerId,
          items: offerItems,
          vatRate: saved.vatRate ?? vatRate,
          currency: saved.currency === "EUR" ? "EUR" : currency,
          sourceOfferId: offerId,
          ...(allOrderIds.length > 0 ? { orderIds: allOrderIds } : {}),
        }),
      });
      if (invRes.ok) {
        const invoice = await invRes.json();
        if (invoice.existed) {
          toast.info(
            `Rechnung ${invoice.invoiceNumber} existiert bereits — wird geöffnet`,
          );
        } else {
          toast.success(`Rechnung ${invoice.invoiceNumber} erstellt`);
        }

        // V17.90L193: Die Rechnung-API setzt den Status atomar. Das Angebot
        // wird sofort aus der normalen Angebotsliste entfernt und erscheint
        // bei einer späteren Rückführung automatisch wieder.
        if (offerId) {
          setOffers((current) =>
            current.filter((offer) => offer.id !== offerId),
          );
          setExpandedOfferCardIds((current) => {
            const next = new Set(current);
            next.delete(offerId);
            return next;
          });
        }

        setDialogOpen(false);
        setFromOrderId(null);
        window.location.href = "/rechnungen";
      } else {
        const errData = await invRes.json().catch(() => null);
        const apiBlockers = Array.isArray(errData?.blockers)
          ? errData.blockers
              .flatMap((entry: any) =>
                Array.isArray(entry?.blockers)
                  ? entry.blockers
                  : typeof entry === "string"
                    ? [entry]
                    : [],
              )
              .filter(Boolean)
              .slice(0, 3)
              .join(", ")
          : "";
        toast.error(
          apiBlockers
            ? `Rechnung nicht möglich: ${apiBlockers}`
            : errData?.error || "Rechnung konnte nicht erstellt werden",
        );
      }
    } catch (err) {
      console.error("saveAndCreateInvoice error:", err);
      toast.error("Fehler beim Erstellen der Rechnung");
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = async (id: string) => {
    window.open(
      `/api/offers/${id}/pdf?_t=${Date.now()}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const sendPdfToWhatsApp = async (off: Offer) => {
    // New flow: server generates PDF, uploads to public S3, and sends
    // it via Twilio directly to the operator's PRIMARY business WhatsApp
    // number (whatsappIntakeNumber → telefon). The operator then forwards
    // the message from their own WhatsApp to the customer.
    // Customer.phone and CompanySettings.telefon2 are NEVER used.
    if (!businessWhatsappNumber) {
      toast.error(
        "Keine WhatsApp-Nummer für den Betrieb hinterlegt. Bitte unter Einstellungen → Kontakt die Hauptnummer (Telefon) oder die WhatsApp-Empfangsnummer eintragen.",
        { duration: 6000 },
      );
      return;
    }
    setDownloading(off.id);
    const sendingToast = toast.loading(
      "PDF wird erstellt und an Ihre WhatsApp gesendet …",
    );
    try {
      const result = await sendPdfToBusinessWhatsApp({
        kind: "offer",
        id: off.id,
      });
      toast.dismiss(sendingToast);
      if (result.ok) {
        toast.success(
          "PDF wurde an Ihre WhatsApp-Nummer gesendet. Sie können es nun aus dem Chat an den Kunden weiterleiten.",
          { duration: 6000 },
        );
      } else if (result.reason === "no_business_number") {
        toast.error(
          result.message ||
            "Keine WhatsApp-Nummer für den Betrieb hinterlegt. Bitte unter Einstellungen → Kontakt die Hauptnummer (Telefon) oder die WhatsApp-Empfangsnummer eintragen.",
          { duration: 6000 },
        );
      } else if (result.reason === "pdf_failed") {
        toast.error(result.message || "PDF konnte nicht erstellt werden.");
      } else if (result.reason === "upload_failed") {
        toast.error(
          result.message ||
            "PDF konnte nicht für den Versand bereitgestellt werden.",
        );
      } else if (result.reason === "twilio_not_configured") {
        toast.error(
          result.message ||
            "WhatsApp-Versand ist nicht konfiguriert. Bitte Twilio-Absendernummer (TWILIO_WHATSAPP_FROM) hinterlegen.",
          { duration: 8000 },
        );
      } else if (result.reason === "twilio_invalid_to") {
        toast.error(
          result.message || "Die hinterlegte WhatsApp-Nummer ist ungültig.",
          { duration: 6000 },
        );
      } else if (result.reason === "twilio_rejected") {
        toast.error(
          result.message || "WhatsApp-Versand wurde von Twilio abgelehnt.",
          { duration: 6000 },
        );
      } else if (result.reason === "twilio_network") {
        toast.error(
          result.message ||
            "Verbindung zu Twilio fehlgeschlagen. Bitte erneut versuchen.",
        );
      } else if (result.reason === "unauthorized") {
        toast.error("Bitte melden Sie sich erneut an.");
      } else {
        toast.error(result.message || "Fehler beim Senden an WhatsApp.");
      }
    } catch (err) {
      toast.dismiss(sendingToast);
      console.error("[angebote] sendPdfToWhatsApp failed", err);
      toast.error("Fehler beim Senden an WhatsApp.");
    } finally {
      setDownloading(null);
    }
  };

  // V17.90L191: Angebotsstatus ohne vollständiges Neuladen aktualisieren.
  // Der vorherige Status wird bei einem API-Fehler exakt wiederhergestellt.
  const updateStatus = async (id: string, status: string) => {
    const previousOffer = offers.find((offer) => offer.id === id);
    if (!previousOffer || previousOffer.status === status) return;

    setOffers((current) =>
      current.map((offer) =>
        offer.id === id ? { ...offer, status } : offer,
      ),
    );

    try {
      const response = await fetch(`/api/offers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          result?.error || "Angebotsstatus konnte nicht aktualisiert werden.",
        );
      }

      setOffers((current) =>
        current.map((offer) =>
          offer.id === id
            ? {
                ...offer,
                status: String(result?.status || status),
                customer: result?.customer || offer.customer,
              }
            : offer,
        ),
      );
      toast.success("Status aktualisiert");
    } catch (error) {
      setOffers((current) =>
        current.map((offer) =>
          offer.id === id ? previousOffer : offer,
        ),
      );
      toast.error(
        error instanceof Error
          ? error.message
          : "Angebotsstatus konnte nicht aktualisiert werden.",
      );
    }
  };

  const remove = (id: string) => {
    setConfirmDialog({
      title: "In Papierkorb verschieben?",
      message: "Das Angebot wird in den Papierkorb verschoben.",
      action: async () => {
        const removedIndex = offers.findIndex((offer) => offer.id === id);
        const removedOffer = removedIndex >= 0 ? offers[removedIndex] : null;
        const restoreOffer = () => {
          if (!removedOffer) return;
          setOffers((current) => {
            if (current.some((offer) => offer.id === removedOffer.id)) return current;
            const next = [...current];
            next.splice(Math.min(Math.max(removedIndex, 0), next.length), 0, removedOffer);
            return next;
          });
        };

        setOffers((current) => current.filter((offer) => offer.id !== id));
        try {
          const res = await fetch(`/api/offers/${id}`, { method: "DELETE" });
          if (!res.ok) {
            const result = await res.json().catch(() => ({}));
            restoreOffer();
            toast.error(result?.error || "Angebot konnte nicht verschoben werden");
            return;
          }
          toast.success("Angebot in Papierkorb verschoben");
        } catch {
          restoreOffer();
          toast.error("Fehler beim Verschieben in den Papierkorb");
        }
      },
    });
  };

  const moveBackToOrders = (off: Offer) => {
    setConfirmDialog({
      title: "Zurück zu Aufträge?",
      message: "Angebot löschen und Auftrag zurück zu Aufträge verschieben?",
      action: async () => {
        await fetch(`/api/offers/${off.id}`, { method: "DELETE" });
        toast.success("Auftrag zurück zu Aufträge verschoben");
        load();
      },
    });
  };

  const revertToOrder = (off: Offer) => {
    setConfirmDialog({
      title: "Angebot zurücksetzen?",
      message: `Angebot ${off.offerNumber} zurück zu Aufträgen verschieben? Das Angebot wird gelöscht und die verknüpften Aufträge werden wieder aktiv.`,
      action: async () => {
        if (revertingOfferId) return;
        setRevertingOfferId(off.id);
        try {
          const res = await fetch(`/api/offers/${off.id}/revert`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            toast.error(data.error || "Fehler beim Zurücksetzen");
            return;
          }
          setOffers((current) => current.filter((entry) => entry.id !== off.id));
          toast.success(
            `Angebot zurückgesetzt — ${data.revertedOrders || 0} Auftrag/Aufträge wieder aktiv`,
          );
          router.push("/auftraege");
          router.refresh();
        } catch {
          toast.error("Fehler beim Zurücksetzen");
        } finally {
          setRevertingOfferId(null);
        }
      },
    });
  };

  const createInvoiceDirectly = async (off: Offer) => {
    // Direkt Rechnung erstellen via API — kein Extra-Dialog
    const invoiceItems =
      off.items?.map((it: any) => ({
        description: it.description ?? "",
        quantity: String(it.quantity ?? 0),
        unit: it.unit ?? "",
        unitPrice: String(it.unitPrice ?? 0),
        siteName: it.siteName || null,
        siteAddress: it.siteAddress || null,
        sitePlz: it.sitePlz || null,
        siteCity: it.siteCity || null,
        siteNote: it.siteNote || null,
        sourceOrderId: it.sourceOrderId || null,
      })) ?? [];
    const conversionBlockers = getOfferToInvoiceBlockersV17_90L174(invoiceItems);
    if (conversionBlockers.length > 0) {
      toast.error(`Rechnung nicht möglich: ${conversionBlockers.slice(0, 3).join(", ")}`);
      openEditOffer(off);
      return;
    }
    try {
      // Carry over linked order IDs so intake time is preserved on the invoice
      const linkedOrderIds = off.orders?.map((o) => o.id).filter(Boolean) ?? [];
      const invRes = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: off.customerId,
          items: invoiceItems,
          vatRate: off.vatRate ?? defaultVatRate,
          currency: off.currency === "EUR" ? "EUR" : "CHF",
          sourceOfferId: off.id,
          ...(linkedOrderIds.length > 0 ? { orderIds: linkedOrderIds } : {}),
        }),
      });
      if (invRes.ok) {
        const invoice = await invRes.json();
        // V17.90L193: Das weitergeführte Angebot verschwindet aus der
        // Angebotsliste. Die API hält Status und Dokumentverknüpfung zusammen.
        setOffers((current) =>
          current.filter((offer) => offer.id !== off.id),
        );
        setExpandedOfferCardIds((current) => {
          const next = new Set(current);
          next.delete(off.id);
          return next;
        });
        if (invoice.existed) {
          toast.info(
            `Rechnung ${invoice.invoiceNumber} existiert bereits — wird geöffnet`,
          );
        } else {
          toast.success(
            `Rechnung ${invoice.invoiceNumber} erstellt — Angebot zu Rechnungen verschoben`,
          );
        }
        window.location.href = "/rechnungen";
      } else {
        const errData = await invRes.json().catch(() => null);
        const apiBlockers = Array.isArray(errData?.blockers)
          ? errData.blockers
              .flatMap((entry: any) =>
                Array.isArray(entry?.blockers)
                  ? entry.blockers
                  : typeof entry === "string"
                    ? [entry]
                    : [],
              )
              .filter(Boolean)
              .slice(0, 3)
              .join(", ")
          : "";
        toast.error(
          apiBlockers
            ? `Rechnung nicht möglich: ${apiBlockers}`
            : errData?.error || "Rechnung konnte nicht erstellt werden",
        );
      }
    } catch {
      toast.error("Fehler beim Erstellen der Rechnung");
    }
  };

  const renderActiveMobileTooltipSheet = () => {
    if (!activeMobileTooltip) return null;
    const safety = uniqueOfferLines(activeMobileTooltip.safetyWarnings || []);
    const primary = uniqueOfferLines(activeMobileTooltip.primaryHints || []).filter(
      (line) => !safety.some((warning) => normalizeOfferHint(warning) === normalizeOfferHint(line)),
    );
    const primaryKeys = new Set(primary.map(normalizeOfferHint));
    const hints = uniqueOfferLines(activeMobileTooltip.jobHints || []).filter(
      (line) =>
        !safety.some((warning) => normalizeOfferHint(warning) === normalizeOfferHint(line)) &&
        !primaryKeys.has(normalizeOfferHint(line)),
    );
    const textValue = String(activeMobileTooltip.text || "").trim();
    const mobileTooltipKeyTail = activeMobileTooltip.key.split(":").pop() || "";
    const isAppointmentTooltip =
      /(?:^|[-_])appointments?(?:[-_]|$)/i.test(mobileTooltipKeyTail) ||
      mobileTooltipKeyTail === "appointment";
    const isOperationalDanger = ["dog", "danger"].includes(mobileTooltipKeyTail);
    const isOperationalWarning = ["parking", "ladder", "key", "access"].includes(
      mobileTooltipKeyTail,
    );
    const isServiceReview =
      activeMobileTooltip.kind === "service_review" ||
      Boolean(
        activeMobileTooltip.reviewSections &&
          activeMobileTooltip.reviewSections.length > 0,
      );
    const closeSheet = () => {
      setActiveMobileTooltip(null);
      setActiveMobileReviewSiteKey(null);
    };

    if (!isServiceReview) {
      const viewportWidth =
        typeof window !== "undefined" ? window.innerWidth : 390;
      const viewportHeight =
        typeof window !== "undefined" ? window.innerHeight : 760;
      const popoverWidth = Math.min(368, Math.max(240, viewportWidth - 16));
      const rect = activeMobileTooltip.anchorRect;
      const rawCenter = rect ? rect.left + rect.width / 2 : viewportWidth / 2;
      const half = popoverWidth / 2;
      const center = Math.min(
        Math.max(rawCenter, half + 8),
        viewportWidth - half - 8,
      );
      const edge = 10;
      const gap = 8;
      const availableAbove = rect ? Math.max(0, rect.top - edge - gap) : viewportHeight - edge * 2;
      const availableBelow = rect
        ? Math.max(0, viewportHeight - rect.bottom - edge - gap)
        : viewportHeight - edge * 2;
      const desiredHeight = Math.min(560, Math.floor(viewportHeight * 0.68));
      const minimumUsableTooltipSpace = 120;
      const placeBelow = rect
        ? availableAbove >= minimumUsableTooltipSpace
          ? false
          : availableBelow >= minimumUsableTooltipSpace
            ? true
            : availableBelow > availableAbove
        : false;
      const availableHeight = placeBelow ? availableBelow : availableAbove;
      const maxHeight = Math.max(1, Math.min(desiredHeight, availableHeight || desiredHeight));
      const positionStyle = rect
        ? {
            left: `${center}px`,
            top: placeBelow ? `${rect.bottom + gap}px` : `${rect.top - gap}px`,
            width: `${popoverWidth}px`,
            maxHeight: `${maxHeight}px`,
            transform: placeBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)",
          }
        : {
            left: "50%",
            top: "50%",
            width: `${popoverWidth}px`,
            maxHeight: `${Math.min(desiredHeight, viewportHeight - edge * 2)}px`,
            transform: "translate(-50%, -50%)",
          };

      return (
        <div className="fixed inset-0 z-[12000]">
          <button
            type="button"
            aria-label="Hinweis schließen"
            className="absolute inset-0 cursor-default bg-transparent"
            onClick={(event) => {
              event.stopPropagation();
              closeSheet();
            }}
          />
          <div
            className="fixed overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-3 text-left text-[13px] font-medium leading-snug text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            style={positionStyle}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={clearOfferMobileInfoAutoCloseV17_90L175}
            onPointerUp={scheduleOfferMobileInfoAutoCloseV17_90L175}
            onTouchStart={clearOfferMobileInfoAutoCloseV17_90L175}
            onTouchEnd={scheduleOfferMobileInfoAutoCloseV17_90L175}
            onScroll={clearOfferMobileInfoAutoCloseV17_90L175}
          >
            {activeMobileTooltip.kind === "execution_address" ? (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-sky-800 dark:text-sky-200">
                  <MapPin className="h-4 w-4" /> Ausführungsadresse
                </div>
                <div className="space-y-1.5">
                  {textValue
                    .split("\n")
                    .slice(1)
                    .map((line, index) => {
                      const match = line.match(
                        /^(Objekt|Strasse|PLZ \/ Ort|Hinweis):\s*(.*)$/i,
                      );
                      if (!match) return null;
                      const isObject = /^Objekt$/i.test(match[1]);
                      return (
                        <div
                          key={`offer_mobile_address_${index}`}
                          className="grid grid-cols-[76px_1fr] gap-x-2"
                        >
                          <span className="text-muted-foreground">{match[1]}:</span>
                          <span
                            className={`break-words ${
                              isObject
                                ? "font-bold text-slate-950 dark:text-slate-50"
                                : "font-normal"
                            }`}
                          >
                            {match[2] || "–"}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            ) : (
              <>
                {safety.length > 0 && (
                  <div className="mb-2 rounded-lg border border-red-300 bg-red-50 p-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-100">
                    <div className="mb-1 flex items-center gap-1 font-bold">
                      <AlertTriangle className="h-3.5 w-3.5" /> Gefahr / Achtung
                    </div>
                    {safety.map((line, index) => (
                      <div
                        key={`offer_mobile_compact_safety_${index}`}
                        className="whitespace-pre-wrap break-words"
                      >
                        • {line}
                      </div>
                    ))}
                  </div>
                )}
                {primary.length > 0 && (
                  <div className="mb-2 rounded-lg border border-blue-300 bg-blue-50 p-2 text-blue-900 dark:border-blue-800/70 dark:bg-blue-950/30 dark:text-blue-100">
                    <div className="mb-1 flex items-center gap-1 font-bold"><Info className="h-3.5 w-3.5" /> Wichtige Informationen</div>
                    {primary.map((line, index) => (
                      <div key={`offer_mobile_compact_primary_${index}`} className="whitespace-pre-wrap break-words">{line}</div>
                    ))}
                  </div>
                )}
                {hints.length > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-100">
                    <div className="mb-1 font-bold">Weitere Besonderheiten</div>
                    {hints.map((line, index) => (
                      <div
                        key={`offer_mobile_compact_hint_${index}`}
                        className="whitespace-pre-wrap break-words"
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                )}
                {textValue && safety.length === 0 && primary.length === 0 && hints.length === 0 && (
                  isAppointmentTooltip ? (
                    <OfferAppointmentTooltipContentV17_90L169 text={textValue} />
                  ) : isOperationalDanger || isOperationalWarning ? (
                    <OfferOperationalTooltipContentV17_90L169
                      chip={{
                        key: mobileTooltipKeyTail || "hint",
                        title: textValue,
                        icon: isOperationalDanger ? "⚠️" : "!",
                        tone: isOperationalDanger ? "danger" : "warning",
                      }}
                    />
                  ) : (
                    <div className="whitespace-pre-wrap break-words">{textValue}</div>
                  )
                )}
              </>
            )}
          </div>
        </div>
      );
    }

    const sheetTitle =
      activeMobileTooltip.reviewTitle || "Leistungen prüfen";
    const reviewSiteGroups = activeMobileTooltip.reviewSiteGroups || [];
    const renderOfferMobileReviewSections = (
      sections: OfferServiceReviewSection[],
      keyPrefix: string,
    ) => (
      <div className="space-y-3">
        {sections.map((section, sectionIndex) => (
          <div
            key={`${keyPrefix}_section_${sectionIndex}`}
            className={
              sectionIndex > 0
                ? "border-t border-slate-200 pt-3 dark:border-slate-700"
                : ""
            }
          >
            <div className="mb-1.5 font-bold text-slate-950 dark:text-slate-50">
              {section.title}
            </div>
            <div className="space-y-2">
              {section.items.map((item, itemIndex) => (
                <div
                  key={`${keyPrefix}_item_${sectionIndex}_${itemIndex}`}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60"
                >
                  <div className="font-bold text-slate-950 dark:text-slate-50">
                    * {item.title}
                  </div>
                  {item.details.map((detail, detailIndex) => {
                    const trimmedDetail = detail.trim();
                    const isCurrentPrice = /^(?:Aktuell|Berechnung):/i.test(
                      trimmedDetail,
                    );
                    const isCatalogPrice = /^Katalogpreis:/i.test(trimmedDetail);
                    return (
                      <div
                        key={`${keyPrefix}_detail_${sectionIndex}_${itemIndex}_${detailIndex}`}
                        className={`break-words text-[13px] ${
                          isCurrentPrice
                            ? "font-bold text-slate-950 dark:text-slate-50"
                            : isCatalogPrice
                              ? "font-normal text-slate-500 dark:text-slate-400"
                              : "text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        {detail}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );

    return (
      <div className="fixed inset-0 z-[12000]">
        <button
          type="button"
          aria-label="Hinweis schließen"
          className="absolute inset-0 cursor-default bg-black/25 backdrop-blur-[1px]"
          onClick={(event) => {
            event.stopPropagation();
            closeSheet();
          }}
        />
        <div
          className="fixed left-3 right-3 top-1/2 flex max-h-[82vh] min-h-0 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left text-[13px] font-medium leading-snug text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:left-1/2 sm:right-auto sm:w-[min(34rem,calc(100vw-2rem))] sm:-translate-x-1/2"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="min-w-0 truncate text-base font-bold text-slate-950 dark:text-slate-50">
              {sheetTitle}
            </div>
            <button
              type="button"
              aria-label="Hinweis schließen"
              onClick={closeSheet}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-700 shadow-sm active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-3 py-3 pb-5">
            {reviewSiteGroups.length > 1 ? (
              <div className="space-y-2">
                {reviewSiteGroups.map((group, groupIndex) => {
                  const active = activeMobileReviewSiteKey === group.key;
                  const address = [
                    group.site?.siteAddress,
                    [group.site?.sitePlz, group.site?.siteCity]
                      .filter(Boolean)
                      .join(" "),
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Adresse nicht angegeben";
                  return (
                    <div
                      key={`offer_mobile_group_${group.key}`}
                      className={`overflow-hidden rounded-xl border ${
                        active
                          ? "border-cyan-300"
                          : "border-slate-200 dark:border-slate-700"
                      }`}
                    >
                      <button
                        type="button"
                        className={`flex w-full items-start justify-between gap-3 p-3 text-left ${
                          active
                            ? "bg-cyan-50 dark:bg-cyan-950/30"
                            : "bg-slate-50 dark:bg-slate-800/60"
                        }`}
                        onClick={() =>
                          setActiveMobileReviewSiteKey((current) =>
                            current === group.key ? null : group.key,
                          )
                        }
                      >
                        <span className="min-w-0">
                          <span className="block break-words font-bold text-slate-950 dark:text-slate-50">
                            {groupIndex + 1}. {group.site?.siteName || group.site?.siteAddress || `Ausführungsort ${groupIndex + 1}`}
                          </span>
                          <span className="mt-0.5 block break-words text-[11px] text-slate-600 dark:text-slate-300">
                            {address}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full border border-amber-300 bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-900">
                          Leistungen prüfen · {group.count}
                        </span>
                      </button>
                      {active && (
                        <div className="border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                          {renderOfferMobileReviewSections(
                            group.sections,
                            `offer_mobile_group_${group.key}`,
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              renderOfferMobileReviewSections(
                activeMobileTooltip.reviewSections || [],
                "offer_mobile_review",
              )
            )}
          </div>
        </div>
      </div>
    );
  };

  if (loading)
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  if (loadError)
    return <LoadErrorFallback details={loadError} onRetry={load} />;

  return (
    <div className="space-y-4 pb-16 md:pb-8">
      {renderActiveMobileTooltipSheet()}

      <div className="pointer-events-none fixed left-16 top-0 z-40 flex h-14 items-center">
        <span className="font-display text-sm font-bold sm:text-base">Angebote</span>
      </div>

      <div className="fixed left-1/2 top-0 z-40 flex h-14 -translate-x-1/2 items-center">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-slate-300 bg-background/95 p-0.5 shadow-sm backdrop-blur">
          <button
            type="button"
            onClick={() => router.push("/auftraege")}
            className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-semibold hover:bg-muted"
            aria-label="Zu Aufträge"
            title="Zu Aufträge"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Aufträge</span>
          </button>
          <span className="h-4 w-px bg-slate-300 dark:bg-slate-700" aria-hidden="true" />
          <button
            type="button"
            onClick={() => router.push("/rechnungen")}
            className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-semibold hover:bg-muted"
            aria-label="Zu Rechnungen"
            title="Zu Rechnungen"
          >
            <span className="hidden sm:inline">Rechnungen</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="-mx-2 px-2 py-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {offers?.length ?? 0} Angebote
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2.5 text-xs"
              onClick={toggleAllOfferCards}
              disabled={offers.length === 0}
            >
              {allOfferCardsExpanded ? "Alle schließen" : "Alle öffnen"}
            </Button>
            <Button className="h-8 px-2.5 text-xs" onClick={openNewOffer}>
              <Plus className="mr-1 h-4 w-4" />
              <span className="hidden sm:inline">Neues Angebot</span>
              <span className="sm:hidden">Neu</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Name, Ort, Leistung, Angebots-Nr…"
            className="pl-10 h-9 text-sm"
            value={searchText}
            onChange={(e: any) => setSearchText(e?.target?.value ?? "")}
          />
        </div>
        <select
          className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9"
          value={statusFilter}
          onChange={(e: any) => setStatusFilter(e?.target?.value ?? "Alle")}
        >
          <option value="Alle">Alle</option>
          <option value="Entwurf">Entwurf</option>
          <option value="Gesendet">Gesendet</option>
          <option value="Angenommen">Angenommen</option>
          <option value="Abgelehnt">Abgelehnt</option>
        </select>
        <select
          className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9"
          value={sortBy}
          onChange={(e: any) => setSortBy(e?.target?.value ?? "newest")}
        >
          <option value="newest">Neueste zuerst</option>
          <option value="oldest">Älteste zuerst</option>
          <option value="name">Name A–Z</option>
          <option value="amount">Betrag ↓</option>
        </select>
      </div>

      <div className="space-y-1.5">
        {(() => {
          const filteredOffers = offers
            .filter((off: Offer) => {
              if (statusFilter !== "Alle" && off.status !== statusFilter)
                return false;
              const s = searchText?.toLowerCase() ?? "";
              if (!s) return true;
              const itemNames =
                off.items
                  ?.map((it: any) => it.description)
                  .filter(Boolean)
                  .join(" ") || "";
              return (
                off?.customer?.name?.toLowerCase()?.includes(s) ||
                off?.customer?.city?.toLowerCase()?.includes(s) ||
                itemNames.toLowerCase().includes(s) ||
                off?.offerNumber?.toLowerCase()?.includes(s) ||
                off?.customer?.customerNumber?.toLowerCase()?.includes(s)
              );
            })
            .sort((a: Offer, b: Offer) => {
              switch (sortBy) {
                case "oldest":
                  return (
                    new Date(a.createdAt ?? a.offerDate ?? 0).getTime() -
                    new Date(b.createdAt ?? b.offerDate ?? 0).getTime()
                  );
                case "name":
                  return (a.customer?.name ?? "").localeCompare(
                    b.customer?.name ?? "",
                  );
                case "amount":
                  return (Number(b.total) || 0) - (Number(a.total) || 0);
                default:
                  return (
                    new Date(b.createdAt ?? b.offerDate ?? 0).getTime() -
                    new Date(a.createdAt ?? a.offerDate ?? 0).getTime()
                  );
              }
            });
          return confirmDialog ? null : filteredOffers.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              Keine Angebote gefunden
            </p>
          ) : (
            <>
              {filteredOffers
                .slice(0, visibleCount)
                .map((off: Offer, i: number) => {
                  const linkedOrder = (off.orders?.[0] || null) as any;
                  const customerIdCandidates = [
                    off.customerId,
                    (off.customer as any)?.id,
                    linkedOrder?.customerId,
                    linkedOrder?.customer?.id,
                  ]
                    .map((value) => String(value || "").trim())
                    .filter(Boolean);
                  const customerNumberCandidates = [
                    off.customer?.customerNumber,
                    (off as any)?.customerNumber,
                    linkedOrder?.customerNumber,
                    linkedOrder?.customer?.customerNumber,
                  ]
                    .map((value) => String(value || "").trim())
                    .filter(Boolean);
                  const normalizeCustomerNumber = (value: unknown) =>
                    String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
                  const normalizedNumberCandidates = customerNumberCandidates
                    .map(normalizeCustomerNumber)
                    .filter(Boolean);
                  const offerCustomerEmail = String(
                    off.customer?.email || linkedOrder?.customer?.email || "",
                  ).trim().toLowerCase();
                  const offerCustomerAddress = normalizeOfferHint(
                    off.customer?.address || linkedOrder?.customer?.address || "",
                  );
                  const customerFromMaster = customers.find((customer) => {
                    const customerId = String(customer?.id || "").trim();
                    const customerNumber = normalizeCustomerNumber(customer?.customerNumber);
                    const customerEmail = String(customer?.email || "").trim().toLowerCase();
                    const customerAddress = normalizeOfferHint(customer?.address || "");
                    return (
                      Boolean(customerId && customerIdCandidates.includes(customerId)) ||
                      Boolean(customerNumber && normalizedNumberCandidates.includes(customerNumber)) ||
                      Boolean(offerCustomerEmail && customerEmail === offerCustomerEmail) ||
                      Boolean(
                        offerCustomerAddress &&
                        customerAddress === offerCustomerAddress &&
                        String(customer?.plz || "").trim() ===
                          String(off.customer?.plz || linkedOrder?.customer?.plz || "").trim(),
                      )
                    );
                  });
                  const linkedOrderCustomer = (off.orders || [])
                    .map((order: any) => order?.customer)
                    .find((customer: any) =>
                      Boolean(String(customer?.name || "").trim()),
                    );
                  // Prefer the authoritative customer master/linked order over
                  // the compact offer relation. Some list payloads only contain an
                  // abbreviated one-letter customer name (for example "R").
                  const cardCustomer =
                    customerFromMaster ||
                    linkedOrderCustomer ||
                    linkedOrder?.customer ||
                    off.customer ||
                    null;
                  const cardCustomerName = pickBestOfferCustomerName(
                    customerFromMaster?.name,
                    linkedOrderCustomer?.name,
                    linkedOrder?.customer?.name,
                    linkedOrder?.customerName,
                    (off as any)?.customerName,
                    off.customer?.name,
                    cardCustomer?.name,
                  );
                  const cardCustomerNumber =
                    String(cardCustomer?.customerNumber || "").trim() ||
                    String((off as any)?.customerNumber || "").trim() ||
                    String(customerFromMaster?.customerNumber || "").trim() ||
                    String(linkedOrder?.customerNumber || "").trim() ||
                    String(linkedOrder?.customer?.customerNumber || "").trim();
                  const itemNames =
                    off.items
                      ?.map((it: any) => it.description)
                      .filter(Boolean)
                      .join(" + ") || "";
                  const isSonstiges = off.items?.some(
                    (it: any) =>
                      (it.description ?? "").toLowerCase() === "sonstiges",
                  );
                  const orderCtx = resolveCommunicationData(null, off.orders);
                  const offerExecutionSites = collectOfferExecutionSites(off);
                  const primaryExecutionSite = offerExecutionSites[0] || null;
                  const mergedCount = getOfferMergedCount(off);
                  const mergedContactEntries = buildMergedContactReviewEntries(
                    (off.orders || []) as any,
                  );
                  const hasMergedContactReview =
                    mergedCount > 1 && mergedContactEntries.length > 1;
                  const parsedOfferNotes = splitSpecialNotes(
                    orderCtx.specialNotes,
                  );
                  const appointmentLabel = resolveOfferAppointmentLabelV17_90L237(
                    (off.orders || []) as any[],
                    orderCtx,
                  );
                  const appointmentDisplayLabel = appointmentLabel;
                  const appointmentChipLabels =
                    buildAdaptiveAppointmentLabels(appointmentDisplayLabel);
                  const contactAction = buildOfferContactAction(
                    orderCtx,
                    cardCustomer,
                  );
                  const infoSummary = buildOfferInfoSummary(
                    orderCtx,
                    parsedOfferNotes,
                    appointmentLabel,
                    contactAction,
                    (off.orders || []) as any[],
                    (off.items || []).map((item: any) => String(item?.description || "")),
                  );
                  const contactChipData = buildOfferContactChipData(
                    orderCtx,
                    cardCustomer,
                    contactAction,
                  );
                  const callbackChip = buildOfferCallbackChip(contactAction);
                  const operationalChips = buildOfferOperationalChips(
                    parsedOfferNotes.safetyWarnings,
                    parsedOfferNotes.jobHints,
                  );
                  const dangerChips = operationalChips.filter(
                    (chip) => chip.tone === "danger",
                  );
                  const warningChips = operationalChips.filter(
                    (chip) => chip.tone === "warning",
                  );
                  const hasInfoTooltip =
                    infoSummary.safety.length > 0 ||
                    infoSummary.primary.length > 0 ||
                    infoSummary.additional.length > 0;
                  const offerCurrency =
                    off.currency === "EUR" ? "EUR" : "CHF";
                  const serviceReview = buildOfferServiceReviewSummary(
                    off,
                    services,
                    offerCurrency,
                  );
                  const offerCurrencyReviewDetails =
                    collectOfferCurrencyReviewDetailsV17_90L227(off);
                  const offerCurrencyReviewCount =
                    offerCurrencyReviewDetails.length;
                  const offerCurrencyReviewTooltip =
                    formatOfferCurrencyReviewTooltipV17_90L227(
                      offerCurrencyReviewDetails,
                    );
                  const offerReviewSiteGroups =
                    buildOfferServiceReviewSiteGroupsV17_90L135G(
                      off,
                      offerExecutionSites,
                      services,
                      offerCurrency,
                      "review",
                    );
                  const offerBlockerSiteGroups =
                    buildOfferServiceReviewSiteGroupsV17_90L135G(
                      off,
                      offerExecutionSites,
                      services,
                      offerCurrency,
                      "blocker",
                    );
                  const mobileOfferServiceRows: ResponsiveOfferServiceRowV17_90L231[] =
                    (off.items || [])
                      .map((item: any) => {
                        const name = String(item?.description || "").trim();
                        if (!name) return null;
                        const quantity = Number(item?.quantity || 0);
                        const unitPrice = Number(item?.unitPrice || 0);
                        const storedTotal = Number(item?.totalPrice);
                        const calculatedTotal = quantity * unitPrice;
                        const blocked = Boolean(
                          item?.needsReview &&
                            (!Number.isFinite(storedTotal) || storedTotal <= 0),
                        );
                        const amount =
                          Number.isFinite(storedTotal) && storedTotal > 0
                            ? storedTotal
                            : calculatedTotal;
                        const currency =
                          item?.currency === "EUR" || off.currency === "EUR"
                            ? "EUR"
                            : "CHF";
                        return {
                          name,
                          amountLabel: blocked
                            ? "Preis prüfen"
                            : formatCurrency(
                                Number.isFinite(amount) ? amount : 0,
                                currency,
                              ),
                        };
                      })
                      .filter(
                        (
                          row: ResponsiveOfferServiceRowV17_90L231 | null,
                        ): row is ResponsiveOfferServiceRowV17_90L231 =>
                          Boolean(row),
                      );
                  const mobileOfferServiceNames = mobileOfferServiceRows.map(
                    (row) => row.name,
                  );
                  const mobileOfferServicesExpanded =
                    expandedMobileServiceCards.has(off.id);
                  const offerCardExpanded = expandedOfferCardIds.has(off.id);
                  const openOfferChipTarget = (
                    section: "execution" | "items" | "details",
                    event: any,
                    detail?: string,
                  ) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setActiveMobileTooltip(null);
                    openOfferSection(off, section, detail);
                  };

                  const renderOfferCompactReviewChip = (
                    tone: "yellow" | "red",
                    slot: string,
                  ) => {
                    const isRed = tone === "red";
                    const count = isRed
                      ? serviceReview.blockerCount
                      : serviceReview.reviewCount;
                    if (count <= 0) return null;

                    const title = isRed
                      ? `Preis / Menge / Einheit prüfen · ${count}`
                      : `Leistungen prüfen · ${count}`;
                    const sections = isRed
                      ? serviceReview.blockerSections
                      : serviceReview.reviewSections;

                    return (
                      <button
                        key={`${slot}-${tone}`}
                        type="button"
                        aria-label={title}
                        onPointerDown={(event) => event.stopPropagation()}
                        onTouchStart={(event) => event.stopPropagation()}
                        onClick={(event) =>
                          useTouchChipPopovers
                            ? toggleOfferMobileTooltip(
                                {
                                  key: `${off.id}:${slot}:${tone}`,
                                  reviewTitle: title,
                                  reviewSections: sections,
                                  reviewSiteGroups: isRed
                                    ? offerBlockerSiteGroups
                                    : offerReviewSiteGroups,
                                },
                                event,
                              )
                            : openOfferChipTarget("items", event, title)
                        }
                        className={`group relative inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-full px-2 py-0 text-[10px] font-bold shadow-sm outline-none focus:ring-2 focus:ring-offset-1 ${
                          isRed
                            ? "border border-red-300 bg-red-100 text-red-800 hover:bg-red-200 focus:ring-red-300"
                            : "border border-yellow-400 bg-yellow-100 text-yellow-900 ring-1 ring-yellow-200/70 hover:bg-yellow-200 focus:ring-yellow-300"
                        }`}
                      >
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span>{count}</span>
                        {!useTouchChipPopovers && (
                          <OfferServiceReviewTooltip
                            title={title}
                            sections={sections}
                            siteGroups={isRed ? offerBlockerSiteGroups : offerReviewSiteGroups}
                            align="right"
                          />
                        )}
                      </button>
                    );
                  };


                  const renderOfferCompactFunctionalChips = () => (
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-visible">
                      <div
                        className="inline-flex empty:hidden [&_svg]:h-[18px] [&_svg]:w-[18px]"
                        onPointerDown={(event) => event.stopPropagation()}
                        onTouchStart={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          const actionHref = findOfferCommunicationActionHref(
                            event.target,
                          );
                          if (actionHref) {
                            event.stopPropagation();
                            setActiveMobileTooltip(null);
                            return;
                          }
                          const element = (
                            event.target as HTMLElement
                          ).closest<HTMLElement>(
                            "[aria-label], [title], button, a",
                          );
                          const detail =
                            element?.getAttribute("aria-label") ||
                            element?.getAttribute("title") ||
                            "Kontakt";
                          toggleOfferMobileTooltip(
                            {
                              key: `${off.id}:compact-contact:${detail}`,
                              text: detail,
                            },
                            event,
                          );
                        }}
                      >
                        {hasMergedContactReview ? (
                          <MergedContactReviewChip
                            records={(off.orders || []) as any}
                            compact
                          />
                        ) : (
                          <CommunicationChips
                            data={contactChipData}
                            compact
                            onAudioClick={() =>
                              orderCtx.mediaUrl &&
                              openMedia(orderCtx.mediaUrl, "audio")
                            }
                            onImageClick={() => {
                              const imgs = orderCtx.imageUrls;
                              if (imgs && imgs.length > 0) openImageGallery(imgs);
                              else if (orderCtx.mediaUrl)
                                openMedia(orderCtx.mediaUrl, "image");
                            }}
                          />
                        )}
                      </div>

                      {!hasMergedContactReview && callbackChip && (
                        <span className="mr-1 inline-flex border-r border-slate-200 pr-2 dark:border-slate-700">
                          {callbackChip.href ? (
                            <a
                              href={callbackChip.href}
                              onClick={(event) => {
                                event.stopPropagation();
                                setActiveMobileTooltip(null);
                              }}
                              className="group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-700"
                              aria-label={callbackChip.title}
                            >
                              <Phone className="h-4 w-4" />
                              {!useTouchChipPopovers && (
                                <OfferContactTooltip
                                  heading="Telefonkontakt"
                                  name={callbackChip.name}
                                  value={callbackChip.displayPhone}
                                  hint="Antippen oder anklicken, um anzurufen."
                                />
                              )}
                            </a>
                          ) : (
                            <button
                              type="button"
                              onPointerDown={(event) => event.stopPropagation()}
                              onTouchStart={(event) => event.stopPropagation()}
                              onClick={(event) =>
                                useTouchChipPopovers
                                  ? toggleOfferMobileTooltip(
                                      {
                                        key: `${off.id}:compact-callback`,
                                        text: callbackChip.title,
                                      },
                                      event,
                                    )
                                  : openOfferChipTarget(
                                      "details",
                                      event,
                                      callbackChip.title,
                                    )
                              }
                              className="group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-700"
                              aria-label={callbackChip.title}
                            >
                              <Phone className="h-4 w-4" />
                              {!useTouchChipPopovers && (
                                <OfferContactTooltip
                                  heading="Telefonkontakt"
                                  name={callbackChip.name}
                                  value={callbackChip.displayPhone}
                                  hint="Antippen oder anklicken, um anzurufen."
                                />
                              )}
                            </button>
                          )}
                        </span>
                      )}

                      {hasInfoTooltip && (
                        <button
                          type="button"
                          onPointerDown={(event) => event.stopPropagation()}
                          onTouchStart={(event) => event.stopPropagation()}
                          onClick={(event) =>
                            useTouchChipPopovers
                              ? toggleOfferMobileTooltip(
                                  {
                                    key: `${off.id}:compact-info`,
                                    safetyWarnings: infoSummary.safety,
                                    primaryHints: infoSummary.primary,
                                    jobHints: infoSummary.additional,
                                  },
                                  event,
                                )
                              : openOfferChipTarget(
                                  "details",
                                  event,
                                  "Besonderheiten",
                                )
                          }
                          className="group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-700"
                          aria-label="Besonderheiten anzeigen"
                        >
                          <Info className="h-4 w-4" />
                          {!useTouchChipPopovers && (
                            <OfferInfoTooltip summary={infoSummary} />
                          )}
                        </button>
                      )}

                      {dangerChips.map((chip) => (
                        <button
                          key={`compact_${chip.key}`}
                          type="button"
                          onPointerDown={(event) => event.stopPropagation()}
                          onTouchStart={(event) => event.stopPropagation()}
                          onClick={(event) =>
                            useTouchChipPopovers
                              ? toggleOfferMobileTooltip(
                                  {
                                    key: `${off.id}:compact:${chip.key}`,
                                    text: chip.title,
                                  },
                                  event,
                                )
                              : openOfferChipTarget(
                                  "details",
                                  event,
                                  chip.title,
                                )
                          }
                          className="group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 border-red-300 bg-red-100 text-[17px] text-red-800"
                          aria-label={chip.title}
                        >
                          {renderOfferOperationalChipIcon(chip)}
                          {!useTouchChipPopovers && (
                            <OfferOperationalTooltipV17_90L169 chip={chip} />
                          )}
                        </button>
                      ))}

                      {warningChips.map((chip) => (
                        <button
                          key={`compact_${chip.key}`}
                          type="button"
                          onPointerDown={(event) => event.stopPropagation()}
                          onTouchStart={(event) => event.stopPropagation()}
                          onClick={(event) =>
                            useTouchChipPopovers
                              ? toggleOfferMobileTooltip(
                                  {
                                    key: `${off.id}:compact:${chip.key}`,
                                    text: chip.title,
                                  },
                                  event,
                                )
                              : openOfferChipTarget(
                                  "details",
                                  event,
                                  chip.title,
                                )
                          }
                          className={`group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 text-[17px] ${
                            chip.key === "parking"
                              ? "border-blue-300 bg-blue-50 font-semibold text-blue-700"
                              : "border-amber-300 bg-amber-100 text-amber-800"
                          }`}
                          aria-label={chip.title}
                        >
                          {renderOfferOperationalChipIcon(chip)}
                          {!useTouchChipPopovers && (
                            <OfferOperationalTooltipV17_90L169 chip={chip} />
                          )}
                        </button>
                      ))}

                      

                    </div>
                  );

                  const renderOfferQuickActions = () => (
                    <div
                      className="ml-auto inline-flex shrink-0 items-center gap-2 border-l border-slate-200 pl-3 dark:border-slate-700"
                      onPointerDown={(event) => event.stopPropagation()}
                      onTouchStart={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void downloadPdf(off.id);
                        }}
                        className="inline-flex h-8 w-9 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 shadow-sm transition hover:-translate-y-px hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-900/50"
                        title="PDF herunterladen"
                        aria-label="PDF herunterladen"
                      >
                        <OfferDirectPdfIcon />
                      </button>
                      {whatsappEnabled && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void sendPdfToWhatsApp(off);
                          }}
                          disabled={downloading === off.id}
                          className="inline-flex h-8 w-10 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm transition hover:-translate-y-px hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-1 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
                          title="PDF per WhatsApp senden"
                          aria-label="PDF per WhatsApp senden"
                        >
                          {downloading === off.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <OfferPdfWhatsAppIcon />
                          )}
                        </button>
                      )}
                    </div>
                  );

                  const renderOfferCurrencyReviewChip = (slot: string) => {
                    if (offerCurrencyReviewCount <= 0) return null;
                    const title = `Währung prüfen · ${offerCurrencyReviewCount}`;
                    return (
                      <button
                        key={`${slot}-currency-review`}
                        type="button"
                        aria-label={title}
                        onPointerDown={(event) => event.stopPropagation()}
                        onTouchStart={(event) => event.stopPropagation()}
                        onClick={(event) =>
                          useTouchChipPopovers
                            ? toggleOfferMobileTooltip(
                                {
                                  key: `${off.id}:${slot}:currency-review`,
                                  text: offerCurrencyReviewTooltip,
                                },
                                event,
                              )
                            : openOfferChipTarget("items", event, title)
                        }
                        className="group relative inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-full border border-red-300 bg-red-100 px-2 py-0 text-[10px] font-bold text-red-800 shadow-sm hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Währung</span>
                        <span>{offerCurrencyReviewCount}</span>
                        {!useTouchChipPopovers && (
                          <OfferPlainTooltip text={offerCurrencyReviewTooltip} />
                        )}
                      </button>
                    );
                  };

                  const renderOfferCompactServiceReviewChip = () =>
                    serviceReview.reviewCount > 0 ||
                    serviceReview.blockerCount > 0 ||
                    offerCurrencyReviewCount > 0 ||
                    Boolean(appointmentDisplayLabel) ? (
                      <span className="inline-flex shrink-0 items-center border-l border-slate-200 pl-3 dark:border-slate-700">
                        <span className="inline-flex items-center gap-1.5">
                          {renderOfferCompactReviewChip(
                            "yellow",
                            "compact-service-review",
                          )}
                          {renderOfferCompactReviewChip(
                            "red",
                            "compact-service-blocker",
                          )}
                                        {renderOfferCurrencyReviewChip("compact-service-blocker")}
                          {appointmentDisplayLabel && (
                            <button
                              type="button"
                              onPointerDown={(event) => event.stopPropagation()}
                              onTouchStart={(event) => event.stopPropagation()}
                              onClick={(event) =>
                                openOfferChipTarget(
                                  "details",
                                  event,
                                  appointmentDisplayLabel,
                                )
                              }
                              className={`group relative inline-flex h-8 w-8 min-w-0 max-w-full shrink items-center justify-center rounded-full border border-violet-300 bg-violet-50 px-0 text-xs font-semibold text-violet-800 shadow-sm hover:bg-violet-100 ${appointmentChipLabels.dateOnly ? "md:w-auto md:px-2.5" : "md:w-8 md:px-0"}`}
                              aria-label={appointmentDisplayLabel}
                            >
                              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                              {appointmentChipLabels.dateOnly && (
                                <span className="hidden whitespace-nowrap md:ml-1.5 md:inline">
                                  {appointmentChipLabels.dateOnly}
                                </span>
                              )}
                              <span className="sr-only">{appointmentChipLabels.full}</span>
                              <OfferAppointmentTooltipV17_90L169 text={appointmentDisplayLabel} />
                            </button>
                          )}
                        </span>
                      </span>
                    ) : null;

                  return (
                    <motion.div
                      key={off?.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.015 }}
                    >
                      <Card
                        className="border-2 border-slate-400 dark:border-slate-600 hover:border-slate-500 dark:hover:border-slate-500 hover:shadow-sm transition-all tap-safe rounded-xl active:scale-[0.998] overflow-visible"
                        aria-expanded={offerCardExpanded}
                        onClick={(event) => {
                          if (
                            event.target instanceof Element &&
                            event.target.closest(
                              "button, a, input, select, textarea, label, summary, details, [role='button'], [data-card-toggle-ignore='true']",
                            )
                          )
                            return;
                          setActiveMobileTooltip(null);
                          toggleOfferCard(off.id);
                        }}
                      >
                        <CardContent className="px-3 py-2 overflow-visible">
                          <div className="flex items-start gap-2 overflow-visible">
                            {/* Left: 3-dot menu */}
                            <details
                              data-offer-action-menu
                              className="relative shrink-0 group"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <summary
                                className="list-none cursor-pointer p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted [&::-webkit-details-marker]:hidden"
                                title="Aktionen"
                                aria-label="Aktionen"
                              >
                                <MoreVertical className="w-3.5 h-3.5" />
                              </summary>
                              <div className="hidden group-open:block absolute left-0 top-full mt-1 z-[9999] bg-white dark:bg-gray-900 border rounded-lg shadow-lg py-1 min-w-[180px]">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const menu = e.currentTarget.closest("details");
                                    if (menu instanceof HTMLDetailsElement) menu.open = false;
                                    openEditOffer(off);
                                  }}
                                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                                >
                                  <FileCheck className="w-3.5 h-3.5 text-primary" />
                                  Bearbeiten
                                </button>
                                <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const menu = e.currentTarget.closest("details");
                                    if (menu instanceof HTMLDetailsElement) menu.open = false;
                                    createInvoiceDirectly(off);
                                  }}
                                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                                >
                                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                                  Zur Rechnung
                                </button>
                                <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const menu = e.currentTarget.closest("details");
                                    if (menu instanceof HTMLDetailsElement) menu.open = false;
                                    revertToOrder(off);
                                  }}
                                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                                >
                                  <Undo2 className="w-3.5 h-3.5 text-amber-600" />
                                  Zurück zu Auftrag
                                </button>
                                <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const menu = e.currentTarget.closest("details");
                                    if (menu instanceof HTMLDetailsElement) menu.open = false;
                                    remove(off.id);
                                  }}
                                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 flex items-center gap-2"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  Papierkorb
                                </button>
                              </div>
                            </details>

                            {/* Main info — mirrored from the order-card layout */}
                            {!offerCardExpanded && (
                              <div
                                className="min-w-0 flex-1 cursor-pointer rounded-lg px-1.5 py-1 transition-colors hover:bg-slate-100 active:bg-slate-200 dark:hover:bg-slate-800/80 dark:active:bg-slate-700"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setActiveMobileTooltip(null);
                                  toggleOfferCard(off.id);
                                }}
                              >
                                <div className="relative grid min-w-0 grid-cols-1 items-start gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto]">
                                  <div className="min-w-0">
                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-visible md:flex-nowrap md:pr-[40%]">
                                      <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground sm:text-[11px]">
                                        {(() => {
                                          const dt = off.orders?.[0]?.createdAt || off.createdAt;
                                          return dt
                                            ? `${new Date(dt).toLocaleDateString("de-CH", {
                                                day: "2-digit",
                                                month: "2-digit",
                                              })} ${new Date(dt).toLocaleTimeString("de-CH", {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                              })}`
                                            : "";
                                        })()}
                                      </span>
                                      <span className="min-w-0 max-w-[20rem] shrink truncate text-sm font-semibold">
                                        {isFallbackCustomerName(cardCustomerName)
                                          ? "Kunde nicht zugeordnet"
                                          : cardCustomerName}
                                      </span>
                                      {cardCustomerNumber && (
                                        <span className="shrink-0 text-[11px] text-muted-foreground">
                                          ({cardCustomerNumber})
                                        </span>
                                      )}
                                      {offerExecutionSites.length > 0 && (
                                        <button
                                          type="button"
                                          onPointerDown={(event) => event.stopPropagation()}
                                          onTouchStart={(event) => event.stopPropagation()}
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            const tooltipText = offerExecutionSites
                                              .map((site, siteIndex) => {
                                                const place = [site.sitePlz, site.siteCity]
                                                  .filter(Boolean)
                                                  .join(" ");
                                                return [
                                                  `Arbeitsort ${siteIndex + 1}`,
                                                  site.siteName ? `Objekt: ${site.siteName}` : "",
                                                  `Strasse: ${site.siteAddress || "–"}`,
                                                  `PLZ / Ort: ${place || "–"}`,
                                                  site.siteNote ? `Hinweis: ${site.siteNote}` : "",
                                                ]
                                                  .filter(Boolean)
                                                  .join("\n");
                                              })
                                              .join("\n---\n");
                                            if (useTouchChipPopovers) {
                                              toggleOfferMobileTooltip(
                                                {
                                                  key: `${off.id}:compact-execution-sites`,
                                                  kind: "execution_address",
                                                  text: `${
                                                    offerExecutionSites.length > 1
                                                      ? `Ausführungsorte · ${offerExecutionSites.length}`
                                                      : "Ausführungsadresse"
                                                  }\n${tooltipText}`,
                                                },
                                                event,
                                              );
                                            } else {
                                              openOfferSection(off, "execution");
                                            }
                                          }}
                                          className="group relative inline-flex min-w-0 basis-full max-w-full shrink items-center gap-1 overflow-hidden rounded-full border border-cyan-300 bg-cyan-50 px-2 py-1 text-[10px] font-medium text-cyan-800 hover:bg-cyan-100 sm:basis-auto sm:flex-[0_1_18rem] sm:max-w-[18rem]"
                                          aria-label="Ausführungsort anzeigen"
                                        >
                                          <MapPin className="h-3 w-3 shrink-0" />
                                          <span className="truncate">
                                            {offerExecutionSites.length > 1
                                              ? `Ausführungsorte · ${offerExecutionSites.length}`
                                              : primaryExecutionSite?.siteName ||
                                                primaryExecutionSite?.siteAddress ||
                                                "Ausführungsort"}
                                          </span>
                                          {!useTouchChipPopovers && (
                                            <OfferExecutionSitesTooltip sites={offerExecutionSites} />
                                          )}
                                        </button>
                                      )}
                                    </div>
                                    <div className="mt-1 text-[10px] font-medium text-muted-foreground sm:text-[11px]">
                                      Leistungen · {mobileOfferServiceNames.length}
                                    </div>
                                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 overflow-visible border-t border-slate-200 pt-2 dark:border-slate-700">
                                      <select
                                        onClick={(event) => event.stopPropagation()}
                                        className="h-7 shrink-0 rounded-lg border px-2 text-[11px] font-medium"
                                        style={getStatusStyle(
                                          OFFER_STATUS_STYLES,
                                          off?.status ?? "",
                                        )}
                                        value={off?.status ?? ""}
                                        onChange={(event: any) => {
                                          event.stopPropagation();
                                          updateStatus(
                                            off?.id,
                                            event?.target?.value ?? "",
                                          );
                                        }}
                                      >
                                        {offerStatuses.map((status) => (
                                          <option
                                            key={status}
                                            style={getStatusStyle(
                                              OFFER_STATUS_STYLES,
                                              status,
                                            )}
                                          >
                                            {status}
                                          </option>
                                        ))}
                                      </select>
                                      {renderOfferCompactFunctionalChips()}
                                      {renderOfferQuickActions()}
                                      {useTouchChipPopovers ? (
                                        (serviceReview.reviewCount > 0 ||
                                          serviceReview.blockerCount > 0 ||
                                          offerCurrencyReviewCount > 0 ||
                                          Boolean(appointmentDisplayLabel)) && (
                                          <span className="inline-flex shrink-0 items-center border-l border-slate-200 pl-3 dark:border-slate-700">
                                            <span className="inline-flex items-center gap-1.5">
                                              {renderOfferCompactReviewChip(
                                                "yellow",
                                                "compact-touch-service-review",
                                              )}
                                              {renderOfferCompactReviewChip(
                                                "red",
                                                "compact-touch-service-blocker",
                                              )}
                                        {renderOfferCurrencyReviewChip("compact-touch-service-blocker")}
                                              {appointmentDisplayLabel && (
                                                <button
                                                  type="button"
                                                  onPointerDown={(event) => event.stopPropagation()}
                                                  onTouchStart={(event) => event.stopPropagation()}
                                                  onClick={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    toggleOfferMobileTooltip(
                                                      {
                                                        key: `${off.id}:compact-touch-appointment`,
                                                        text: appointmentDisplayLabel,
                                                      },
                                                      event,
                                                    );
                                                  }}
                                                  className="group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-300 bg-violet-50 text-violet-800 shadow-sm hover:bg-violet-100"
                                                  aria-label={appointmentDisplayLabel}
                                                >
                                                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                                                </button>
                                              )}
                                            </span>
                                          </span>
                                        )
                                      ) : (
                                        <>
                                          {renderOfferCompactServiceReviewChip()}
                                        </>
                                      )}
                                    </div>
                                    <div className="mt-2 flex items-center justify-end gap-2 border-t border-slate-200 pt-2 dark:border-slate-700 sm:hidden">
                                      <div className="shrink-0 text-right">
                                        <div className="font-mono text-sm font-bold tabular-nums">
                                          {formatCurrency(
                                            Number(off?.total ?? 0),
                                            off.currency === "EUR" ? "EUR" : "CHF",
                                          )}
                                        </div>
                                      </div>
                                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    </div>
                                  </div>
                                  <div className="ml-auto hidden min-w-[74px] shrink-0 flex-col items-end justify-between gap-2 self-stretch border-l border-slate-200 pl-3 dark:border-slate-700 sm:flex">
                                    <div className="flex min-w-0 items-center justify-end gap-2 self-end">
                                      <div className="shrink-0 text-right">
                                        <div className="font-mono text-sm font-bold tabular-nums">
                                          {formatCurrency(
                                            Number(off?.total ?? 0),
                                            off.currency === "EUR" ? "EUR" : "CHF",
                                          )}
                                        </div>
                                      </div>
                                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                            <div className={`min-w-0 flex-1 ${offerCardExpanded ? "" : "hidden"}`}>
                              {/* Mobile — shared one-column card for Auftrag/Angebot */}
                              <div className="min-w-0">
                                <div
                                  className="flex min-w-0 cursor-pointer flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg px-1.5 py-1 transition-colors hover:bg-blue-50/80 active:bg-blue-100 dark:hover:bg-slate-800/60 dark:active:bg-slate-700 md:flex-nowrap"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setActiveMobileTooltip(null);
                                    toggleOfferCard(off.id);
                                  }}
                                >
                                  <span className="shrink-0 text-[11px] text-muted-foreground">
                                    {(() => {
                                      const dt = off.orders?.[0]?.createdAt || off.createdAt;
                                      return dt
                                        ? `${new Date(dt).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })} · ${new Date(dt).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}`
                                        : "";
                                    })()}
                                  </span>
                                  <span className="min-w-0 max-w-[20rem] shrink truncate text-[15px] font-semibold text-foreground">
                                    {isFallbackCustomerName(cardCustomerName)
                                      ? "Kunde nicht zugeordnet"
                                      : cardCustomerName}
                                  </span>
                                  {cardCustomerNumber && (
                                    <span className="shrink-0 text-[11px] text-muted-foreground">
                                      ({cardCustomerNumber})
                                    </span>
                                  )}
                                  {mergedCount > 1 && (
                                    <span className="shrink-0 rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                                      Zusammengeführt · {mergedCount}
                                    </span>
                                  )}
                                  {offerExecutionSites.length > 0 && (
                                    <button
                                      type="button"
                                      onPointerDown={(event) => event.stopPropagation()}
                                      onTouchStart={(event) => event.stopPropagation()}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        const tooltipText = offerExecutionSites
                                          .map((site, siteIndex) => {
                                            const place = [site.sitePlz, site.siteCity]
                                              .filter(Boolean)
                                              .join(" ");
                                            return [
                                              `Arbeitsort ${siteIndex + 1}`,
                                              site.siteName ? `Objekt: ${site.siteName}` : "",
                                              `Strasse: ${site.siteAddress || "–"}`,
                                              `PLZ / Ort: ${place || "–"}`,
                                              site.siteNote ? `Hinweis: ${site.siteNote}` : "",
                                            ]
                                              .filter(Boolean)
                                              .join("\n");
                                          })
                                          .join("\n---\n");
                                        if (useTouchChipPopovers) {
                                          toggleOfferMobileTooltip(
                                            {
                                              key: `${off.id}:expanded-execution-sites`,
                                              kind: "execution_address",
                                              text: `${
                                                offerExecutionSites.length > 1
                                                  ? `Ausführungsorte · ${offerExecutionSites.length}`
                                                  : "Ausführungsadresse"
                                              }\n${tooltipText}`,
                                            },
                                            event,
                                          );
                                        } else {
                                          openOfferChipTarget("execution", event);
                                        }
                                      }}
                                      className="group relative inline-flex min-w-0 basis-full max-w-full shrink items-center gap-1 overflow-hidden rounded-full border border-cyan-300 bg-cyan-50 px-2 py-1 text-[11px] font-medium text-cyan-800 outline-none hover:bg-cyan-100 focus:ring-2 focus:ring-cyan-300 sm:basis-auto sm:flex-[0_1_18rem] sm:max-w-[18rem]"
                                      aria-label="Ausführungsadresse anzeigen"
                                    >
                                      <MapPin className="h-3 w-3 shrink-0" />
                                      <span className="truncate">
                                        {offerExecutionSites.length > 1
                                          ? `Ausführungsorte · ${offerExecutionSites.length}`
                                          : primaryExecutionSite?.siteName ||
                                            primaryExecutionSite?.siteAddress ||
                                            "Ausführungsadresse"}
                                      </span>
                                      {!useTouchChipPopovers && (
                                        <OfferExecutionSitesTooltip sites={offerExecutionSites} />
                                      )}
                                    </button>
                                  )}
                                  {off?.offerNumber && (
                                    <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-[10px] text-muted-foreground">
                                      {off.offerNumber}
                                    </span>
                                  )}
                                </div>

                                <ResponsiveOfferServicePreviewV17_95
                                  offerId={off.id}
                                  services={mobileOfferServiceRows}
                                  expanded={mobileOfferServicesExpanded}
                                  onToggle={() => toggleMobileServiceCard(off.id)}
                                  onOpenItems={() => openOfferSection(off, "items")}
                                />

                                <div
                                  className="relative mt-2 flex min-h-8 cursor-pointer flex-wrap items-center gap-1.5 overflow-visible rounded-lg px-1.5 py-1 transition-colors hover:bg-blue-50/80 active:bg-blue-100 dark:hover:bg-slate-800/60 dark:active:bg-slate-700"
                                  onClick={(event) => {
                                    if (
                                      event.target instanceof Element &&
                                      event.target.closest(
                                        "button, a, input, select, textarea, label, summary, details, [role='button'], [data-card-toggle-ignore='true']",
                                      )
                                    )
                                      return;
                                    event.stopPropagation();
                                    setActiveMobileTooltip(null);
                                    toggleOfferCard(off.id);
                                  }}
                                >
                                  <select
                                    onClick={(event) => event.stopPropagation()}
                                    className="h-8 shrink-0 rounded-lg border px-2 text-[11px] font-medium"
                                    style={getStatusStyle(
                                      OFFER_STATUS_STYLES,
                                      off?.status ?? "",
                                    )}
                                    value={off?.status ?? ""}
                                    onChange={(event: any) => {
                                      event.stopPropagation();
                                      updateStatus(
                                        off?.id,
                                        event?.target?.value ?? "",
                                      );
                                    }}
                                  >
                                    {offerStatuses.map((status) => (
                                      <option
                                        key={status}
                                        style={getStatusStyle(
                                          OFFER_STATUS_STYLES,
                                          status,
                                        )}
                                      >
                                        {status}
                                      </option>
                                    ))}
                                  </select>

                                  <div
                                    className={`${!hasMergedContactReview && callbackChip ? "" : "mr-1 border-r border-slate-200 pr-2 dark:border-slate-700"} inline-flex empty:hidden [&_svg]:h-[18px] [&_svg]:w-[18px]`}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onTouchStart={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                      const actionHref =
                                        findOfferCommunicationActionHref(
                                          event.target,
                                        );
                                      if (actionHref) {
                                        event.stopPropagation();
                                        setActiveMobileTooltip(null);
                                        return;
                                      }
                                      const element = (
                                        event.target as HTMLElement
                                      ).closest<HTMLElement>(
                                        "[aria-label], [title], button, a",
                                      );
                                      const detail =
                                        element?.getAttribute("aria-label") ||
                                        element?.getAttribute("title") ||
                                        "Kontakt";
                                      toggleOfferMobileTooltip(
                                        {
                                          key: `${off.id}:contact:${detail}`,
                                          text: detail,
                                        },
                                        event,
                                      );
                                    }}
                                  >
                                    {hasMergedContactReview ? (
                                      <MergedContactReviewChip
                                        records={(off.orders || []) as any}
                                        compact
                                      />
                                    ) : (
                                      <CommunicationChips
                                      data={contactChipData}
                                      compact
                                      onAudioClick={() =>
                                        orderCtx.mediaUrl &&
                                        openMedia(orderCtx.mediaUrl, "audio")
                                      }
                                      onImageClick={() => {
                                        const imgs = orderCtx.imageUrls;
                                        if (imgs && imgs.length > 0)
                                          openImageGallery(imgs);
                                        else if (orderCtx.mediaUrl)
                                          openMedia(orderCtx.mediaUrl, "image");
                                      }}
                                    />
                                    )}
                                  </div>

                                  {!hasMergedContactReview && callbackChip && (
                                    <span className="mr-1 inline-flex border-r border-slate-200 pr-2 dark:border-slate-700">
                                      {callbackChip.href ? (
                                      <a
                                        href={callbackChip.href}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setActiveMobileTooltip(null);
                                        }}
                                        className="group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-700"
                                        aria-label={callbackChip.title}
                                      >
                                        <Phone className="h-4 w-4" />
                                        {!useTouchChipPopovers && (
                                          <OfferContactTooltip
                                            heading="Telefonkontakt"
                                            name={callbackChip.name}
                                            value={callbackChip.displayPhone}
                                            hint="Antippen oder anklicken, um anzurufen."
                                          />
                                        )}
                                      </a>
                                    ) : (
                                      <button
                                        type="button"
                                        onPointerDown={(event) => event.stopPropagation()}
                                        onTouchStart={(event) => event.stopPropagation()}
                                        onClick={(event) =>
                                          useTouchChipPopovers
                                            ? toggleOfferMobileTooltip(
                                                {
                                                  key: `${off.id}:callback`,
                                                  text: callbackChip.title,
                                                },
                                                event,
                                              )
                                            : openOfferChipTarget(
                                                "details",
                                                event,
                                                callbackChip.title,
                                              )
                                        }
                                        className="group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-700"
                                        aria-label={callbackChip.title}
                                      >
                                        <Phone className="h-4 w-4" />
                                        {!useTouchChipPopovers && (
                                          <OfferContactTooltip
                                            heading="Telefonkontakt"
                                            name={callbackChip.name}
                                            value={callbackChip.displayPhone}
                                            hint="Antippen oder anklicken, um anzurufen."
                                          />
                                        )}
                                      </button>
                                      )}
                                    </span>
                                  )}

                                  {hasInfoTooltip && (
                                    <button
                                      type="button"
                                      onPointerDown={(event) => event.stopPropagation()}
                                      onTouchStart={(event) => event.stopPropagation()}
                                      onClick={(event) =>
                                        useTouchChipPopovers
                                          ? toggleOfferMobileTooltip(
                                              {
                                                key: `${off.id}:info`,
                                                safetyWarnings: infoSummary.safety,
                                                primaryHints: infoSummary.primary,
                                                jobHints: infoSummary.additional,
                                              },
                                              event,
                                            )
                                          : openOfferChipTarget(
                                              "details",
                                              event,
                                              "Besonderheiten",
                                            )
                                      }
                                      className="group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-700"
                                      aria-label="Besonderheiten anzeigen"
                                    >
                                      <Info className="h-4 w-4" />
                                      {!useTouchChipPopovers && (
                                        <OfferInfoTooltip summary={infoSummary} />
                                      )}
                                    </button>
                                  )}

                                  {dangerChips.map((chip) => (
                                    <button
                                      key={`mobile_${chip.key}`}
                                      type="button"
                                      onPointerDown={(event) => event.stopPropagation()}
                                      onTouchStart={(event) => event.stopPropagation()}
                                      onClick={(event) =>
                                        useTouchChipPopovers
                                          ? toggleOfferMobileTooltip(
                                              {
                                                key: `${off.id}:${chip.key}`,
                                                text: chip.title,
                                              },
                                              event,
                                            )
                                          : openOfferChipTarget(
                                              "details",
                                              event,
                                              chip.title,
                                            )
                                      }
                                      className="group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 border-red-300 bg-red-100 text-[17px] text-red-800"
                                      aria-label={chip.title}
                                    >
                                      {renderOfferOperationalChipIcon(chip)}
                                      {!useTouchChipPopovers && (
                                        <OfferOperationalTooltipV17_90L169 chip={chip} />
                                      )}
                                    </button>
                                  ))}

                                  {warningChips.map((chip) => (
                                    <button
                                      key={`mobile_${chip.key}`}
                                      type="button"
                                      onPointerDown={(event) => event.stopPropagation()}
                                      onTouchStart={(event) => event.stopPropagation()}
                                      onClick={(event) =>
                                        useTouchChipPopovers
                                          ? toggleOfferMobileTooltip(
                                              {
                                                key: `${off.id}:${chip.key}`,
                                                text: chip.title,
                                              },
                                              event,
                                            )
                                          : openOfferChipTarget(
                                              "details",
                                              event,
                                              chip.title,
                                            )
                                      }
                                      className={`group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 text-[17px] ${
                                        chip.key === "parking"
                                          ? "border-blue-300 bg-blue-50 font-semibold text-blue-700"
                                          : "border-amber-300 bg-amber-100 text-amber-800"
                                      }`}
                                      aria-label={chip.title}
                                    >
                                      {renderOfferOperationalChipIcon(chip)}
                                      {!useTouchChipPopovers && (
                                        <OfferOperationalTooltipV17_90L169 chip={chip} />
                                      )}
                                    </button>
                                  ))}


                                  {renderOfferQuickActions()}
                                  {useTouchChipPopovers ? (
                                    (serviceReview.reviewCount > 0 ||
                                      serviceReview.blockerCount > 0 ||
                                      offerCurrencyReviewCount > 0 ||
                                      Boolean(appointmentDisplayLabel)) && (
                                      <span className="inline-flex shrink-0 items-center border-l border-slate-200 pl-3 dark:border-slate-700">
                                        <span className="inline-flex items-center gap-1.5">
                                          {renderOfferCompactReviewChip(
                                            "yellow",
                                            "expanded-touch-service-review",
                                          )}
                                          {renderOfferCompactReviewChip(
                                            "red",
                                            "expanded-touch-service-blocker",
                                          )}
                                        {renderOfferCurrencyReviewChip("expanded-touch-service-blocker")}
                                          {appointmentDisplayLabel && (
                                            <button
                                              type="button"
                                              onPointerDown={(event) => event.stopPropagation()}
                                              onTouchStart={(event) => event.stopPropagation()}
                                              onClick={(event) =>
                                                toggleOfferMobileTooltip(
                                                  {
                                                    key: `${off.id}:expanded-touch-appointment`,
                                                    text: appointmentDisplayLabel,
                                                  },
                                                  event,
                                                )
                                              }
                                              className="group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-300 bg-violet-50 text-violet-700 shadow-sm hover:bg-violet-100"
                                              aria-label={appointmentDisplayLabel}
                                            >
                                              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                                            </button>
                                          )}
                                        </span>
                                      </span>
                                    )
                                  ) : (
                                    <>
                                      {(serviceReview.reviewCount > 0 ||
                                        serviceReview.blockerCount > 0 ||
                                        offerCurrencyReviewCount > 0 ||
                                        Boolean(appointmentDisplayLabel)) && (
                                        <span className="inline-flex shrink-0 items-center border-l border-slate-200 pl-3 dark:border-slate-700">
                                          <span className="inline-flex items-center gap-1.5">
                                            {renderOfferCompactReviewChip(
                                              "yellow",
                                              "expanded-service-review",
                                            )}
                                            {renderOfferCompactReviewChip(
                                              "red",
                                              "expanded-service-blocker",
                                            )}
                                        {renderOfferCurrencyReviewChip("expanded-service-blocker")}
                                            {appointmentDisplayLabel && (
                                              <button
                                                type="button"
                                                onPointerDown={(event) => event.stopPropagation()}
                                                onTouchStart={(event) => event.stopPropagation()}
                                                onClick={(event) =>
                                                  openOfferChipTarget(
                                                    "details",
                                                    event,
                                                    appointmentDisplayLabel,
                                                  )
                                                }
                                                className={`group relative inline-flex h-8 w-8 min-w-0 max-w-full shrink items-center justify-center rounded-full border border-violet-300 bg-violet-50 px-0 text-xs font-semibold text-violet-700 shadow-sm hover:bg-violet-100 ${appointmentChipLabels.dateOnly ? "md:w-auto md:px-2.5" : "md:w-8 md:px-0"}`}
                                                aria-label={appointmentDisplayLabel}
                                              >
                                                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                                                {appointmentChipLabels.dateOnly && (
                                                  <span className="hidden whitespace-nowrap md:ml-1.5 md:inline">
                                                    {appointmentChipLabels.dateOnly}
                                                  </span>
                                                )}
                                                <OfferAppointmentTooltipV17_90L169 text={appointmentDisplayLabel} />
                                              </button>
                                            )}
                                          </span>
                                        </span>
                                      )}
                                    </>
                                  )}
                                </div>

                                <div
                                  className="relative mt-2 flex min-h-0 cursor-pointer items-start justify-end gap-3 rounded-lg border-t border-slate-200 px-1.5 py-2 transition-colors hover:bg-blue-50/80 active:bg-blue-100 dark:border-slate-700 dark:hover:bg-slate-800/60 dark:active:bg-slate-700 sm:min-h-12 sm:justify-between"
                                  onClick={(event) => {
                                    if (
                                      event.target instanceof Element &&
                                      event.target.closest(
                                        "button, a, input, select, textarea, label, summary, details, [role='button'], [data-card-toggle-ignore='true']",
                                      )
                                    )
                                      return;
                                    event.stopPropagation();
                                    setActiveMobileTooltip(null);
                                    toggleOfferCard(off.id);
                                  }}
                                >
                                  <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:flex" />

                                  <div className="ml-auto flex shrink-0 items-end gap-3 sm:flex-col sm:items-end sm:gap-2 sm:border-l sm:border-slate-200 sm:pl-3 sm:dark:border-slate-700">
                                    <div className="shrink-0 whitespace-nowrap text-right leading-tight">
                                      <div className="font-mono text-[16px] font-bold tabular-nums">
                                        {formatCurrency(
                                          Number(off?.total ?? 0),
                                          offerCurrency,
                                        )}
                                      </div>
                                      {Number(off?.vatRate ?? 0) > 0 && (
                                        <div className="text-[9px] leading-none text-muted-foreground">
                                          inkl. MwSt
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Desktop/tablet */}
                              <div className="hidden min-w-0 items-stretch gap-3">
                                <div className="min-w-0 flex-1 overflow-visible">
                                  <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                                    <span className="shrink-0 text-muted-foreground">
                                      {(() => {
                                        const dt = off.orders?.[0]?.createdAt || off.createdAt;
                                        return dt
                                          ? `${new Date(dt).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })} ${new Date(dt).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}`
                                          : "";
                                      })()}
                                    </span>
                                    <span className="shrink-0 text-muted-foreground">·</span>
                                    <span className="min-w-0 max-w-full flex-[0_1_auto] truncate font-medium text-foreground sm:max-w-[18rem] lg:max-w-[24rem] xl:max-w-[30rem]">
                                      {isFallbackCustomerName(cardCustomerName)
                                        ? "⚠️ Kunde nicht zugeordnet"
                                        : cardCustomerName}
                                    </span>
                                    {cardCustomerNumber && (
                                      <span className="shrink-0 text-muted-foreground">
                                        ({cardCustomerNumber})
                                      </span>
                                    )}
                                    {mergedCount > 1 && (
                                      <span className="shrink-0 rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                                        Zusammengeführt · {mergedCount}
                                      </span>
                                    )}
                                    {offerExecutionSites.length > 1 && (
                                      <span className="shrink-0 rounded-full border border-cyan-300 bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-800">
                                        Ausführungsorte · {offerExecutionSites.length}
                                      </span>
                                    )}
                                    {off?.offerNumber && (
                                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                        {off.offerNumber}
                                      </span>
                                    )}

                                    {primaryExecutionSite && offerExecutionSites.length === 1 && (
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          openOfferSection(off, "execution");
                                        }}
                                        className="group relative inline-flex min-w-0 max-w-full flex-[0_1_auto] items-center gap-1 rounded-full border border-cyan-300 bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-800 outline-none hover:bg-cyan-100 focus:ring-2 focus:ring-cyan-300 sm:max-w-[18rem] lg:max-w-[24rem]"
                                        aria-label="Ausführungsadresse anzeigen"
                                      >
                                        <MapPin className="h-3 w-3 shrink-0" />
                                        <span className="truncate">
                                          {primaryExecutionSite.siteName ||
                                            primaryExecutionSite.siteAddress ||
                                            "Ausführungsadresse"}
                                        </span>
                                        <OfferAddressTooltip site={primaryExecutionSite} />
                                      </button>
                                    )}

                                    {isCustomerDataIncomplete(cardCustomer) && (
                                      <MissingCustomerDataBadge
                                        variant="compact"
                                        onClick={() =>
                                          openEditOffer(off, {
                                            openCustomerSection: true,
                                          })
                                        }
                                      />
                                    )}
                                  </div>

                                  <div className="mt-0.5 text-[10px] font-semibold text-muted-foreground">
                                    {mobileOfferServiceNames.length} Leistungen
                                  </div>
                                  <p
                                    className={`mt-0.5 whitespace-normal break-words text-sm font-medium ${
                                      isSonstiges
                                        ? "text-red-600 dark:text-red-400"
                                        : "text-foreground"
                                    }`}
                                  >
                                    {isSonstiges && "⚠ "}
                                    {itemNames}
                                  </p>

                                  <div className="mt-1 flex max-w-full flex-wrap items-center gap-1.5 overflow-visible">
                                    <select
                                      onClick={(event) => event.stopPropagation()}
                                      className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium"
                                      style={getStatusStyle(
                                        OFFER_STATUS_STYLES,
                                        off?.status ?? "",
                                      )}
                                      value={off?.status ?? ""}
                                      onChange={(event: any) => {
                                        event.stopPropagation();
                                        updateStatus(
                                          off?.id,
                                          event?.target?.value ?? "",
                                        );
                                      }}
                                    >
                                      {offerStatuses.map((status) => (
                                        <option
                                          key={status}
                                          style={getStatusStyle(
                                            OFFER_STATUS_STYLES,
                                            status,
                                          )}
                                        >
                                          {status}
                                        </option>
                                      ))}
                                    </select>
                                    <div
                                      className={`${!hasMergedContactReview && callbackChip ? "" : "mr-1 border-r border-slate-200 pr-2 dark:border-slate-700"} inline-flex empty:hidden [&_svg]:h-[18px] [&_svg]:w-[18px]`}
                                      onClick={(event) => {
                                        const actionHref =
                                          findOfferCommunicationActionHref(
                                            event.target,
                                          );
                                        if (actionHref) {
                                          event.stopPropagation();
                                          return;
                                        }
                                        const element = (
                                          event.target as HTMLElement
                                        ).closest<HTMLElement>(
                                          "[aria-label], [title], button, a",
                                        );
                                        const detail =
                                          element?.getAttribute("aria-label") ||
                                          element?.getAttribute("title") ||
                                          "Kontakt";
                                        event.preventDefault();
                                        event.stopPropagation();
                                        element?.blur();
                                        openOfferSection(off, "details", detail);
                                      }}
                                    >
                                      {hasMergedContactReview ? (
                                      <MergedContactReviewChip
                                        records={(off.orders || []) as any}
                                        compact
                                      />
                                    ) : (
                                      <CommunicationChips
                                        data={contactChipData}
                                        compact
                                        onAudioClick={() =>
                                          orderCtx.mediaUrl &&
                                          openMedia(orderCtx.mediaUrl, "audio")
                                        }
                                        onImageClick={() => {
                                          const imgs = orderCtx.imageUrls;
                                          if (imgs && imgs.length > 0)
                                            openImageGallery(imgs);
                                          else if (orderCtx.mediaUrl)
                                            openMedia(orderCtx.mediaUrl, "image");
                                        }}
                                      />
                                      )}
                                    </div>

                                    {!hasMergedContactReview && callbackChip && (
                                      <span className="mr-1 inline-flex border-r border-slate-200 pr-2 dark:border-slate-700">
                                        {callbackChip.href ? (
                                        <a
                                          href={callbackChip.href}
                                          onClick={(event) => event.stopPropagation()}
                                          className="group relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-700 outline-none hover:bg-blue-100 focus:ring-2 focus:ring-blue-300"
                                          aria-label={callbackChip.title}
                                        >
                                          <Phone className="h-4 w-4" />
                                          <OfferContactTooltip
                                            heading="Telefonkontakt"
                                            name={callbackChip.name}
                                            value={callbackChip.displayPhone}
                                            hint="Antippen oder anklicken, um anzurufen."
                                          />
                                        </a>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            openOfferSection(
                                              off,
                                              "details",
                                              callbackChip.title,
                                            );
                                          }}
                                          className="group relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-700 outline-none hover:bg-blue-100 focus:ring-2 focus:ring-blue-300"
                                          aria-label={callbackChip.title}
                                        >
                                          <Phone className="h-4 w-4" />
                                          <OfferContactTooltip
                                            heading="Telefonkontakt"
                                            name={callbackChip.name}
                                            value={callbackChip.displayPhone}
                                            hint="Antippen oder anklicken, um anzurufen."
                                          />
                                        </button>
                                        )}
                                      </span>
                                    )}

                                    {hasInfoTooltip && (
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          openOfferSection(
                                            off,
                                            "details",
                                            undefined,
                                          );
                                        }}
                                        className="group relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-700 outline-none hover:bg-blue-100 focus:ring-2 focus:ring-blue-300"
                                        aria-label="Besonderheiten anzeigen"
                                      >
                                        <Info className="h-4 w-4" />
                                        <OfferInfoTooltip summary={infoSummary} />
                                      </button>
                                    )}

                                    {dangerChips.map((chip) => (
                                      <button
                                        key={chip.key}
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          openOfferSection(off, "details");
                                        }}
                                        className="group relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-red-300 bg-red-100 text-[17px] font-semibold text-red-800 outline-none hover:bg-red-200 focus:ring-2 focus:ring-red-300"
                                        aria-label={chip.title}
                                      >
                                        {renderOfferOperationalChipIcon(chip)}
                                        <OfferOperationalTooltipV17_90L169 chip={chip} />
                                      </button>
                                    ))}

                                    {warningChips.map((chip) => (
                                      <button
                                        key={chip.key}
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          openOfferSection(off, "details");
                                        }}
                                        className={`group relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 text-[17px] font-semibold outline-none focus:ring-2 ${
                                          chip.key === "parking"
                                            ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 focus:ring-blue-300"
                                            : "border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200 focus:ring-amber-300"
                                        }`}
                                        aria-label={chip.title}
                                      >
                                        {renderOfferOperationalChipIcon(chip)}
                                        <OfferOperationalTooltipV17_90L169 chip={chip} />
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <div className="ml-auto flex w-[250px] shrink-0 flex-col items-end justify-between self-stretch gap-1 pt-0.5">
                                  <div className="flex min-h-[22px] flex-wrap justify-end gap-1">
                                    {(serviceReview.reviewCount > 0 ||
                                      serviceReview.blockerCount > 0 ||
                                      offerCurrencyReviewCount > 0) && (
                                      <span className="inline-flex items-center gap-1.5">
                                        {renderOfferCompactReviewChip(
                                          "yellow",
                                          "desktop-service-review",
                                        )}
                                        {renderOfferCompactReviewChip(
                                          "red",
                                          "desktop-service-blocker",
                                        )}
                                        {renderOfferCurrencyReviewChip("desktop-service-blocker")}
                                      </span>
                                    )}
                                    
                                  </div>

                                  <div className="flex w-full flex-wrap items-end justify-end gap-3">
                                  {appointmentLabel && (
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          openOfferSection(
                                            off,
                                            "details",
                                            appointmentLabel,
                                          );
                                        }}
                                        className="group relative inline-flex shrink-0 items-center rounded-full border border-violet-300 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-700 outline-none hover:bg-violet-100 focus:ring-2 focus:ring-violet-300"
                                      >
                                        {appointmentLabel}
                                        <OfferAppointmentTooltipV17_90L169
                                          text={appointmentLabel}
                                          align="right"
                                        />
                                      </button>
                                    )}

                                    <div className="whitespace-nowrap text-right leading-tight">
                                      <div className="font-mono text-sm font-bold tabular-nums">
                                        {formatCurrency(
                                          Number(off?.total ?? 0),
                                          off.currency === "EUR" ? "EUR" : "CHF",
                                        )}
                                      </div>
                                      {Number(off?.vatRate ?? 0) > 0 && (
                                        <div className="text-[9px] leading-none text-muted-foreground">
                                          inkl. MwSt
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              {filteredOffers.length > visibleCount && (
                <div className="text-center pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setVisibleCount((v) => v + 30)}
                  >
                    Mehr laden ({filteredOffers.length - visibleCount} weitere)
                  </Button>
                </div>
              )}
            </>
          );
        })()}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className={`${dupCheckOpen ? "max-w-5xl w-[96vw]" : "max-w-3xl w-[calc(100vw-0.75rem)] sm:w-[95vw]"} max-h-[94vh] scroll-pt-20 overflow-y-auto overflow-x-hidden transition-all [&>button]:hidden`}
        >
          <div className="pointer-events-none sticky top-0 z-[80] flex h-0 justify-end">
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              className="pointer-events-auto mt-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600 shadow-sm transition-colors hover:bg-red-100 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:border-red-900/60 dark:bg-red-950/80 dark:text-red-300 dark:hover:bg-red-900/80"
              aria-label="Bearbeitungsfenster schließen"
              title="Schließen"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <DialogHeader className="pr-12">
            <DialogTitle>
              {editOfferId ? "Angebot bearbeiten" : "Neues Angebot"}
            </DialogTitle>
          </DialogHeader>
          <div
            className={
              dupCheckOpen
                ? "grid grid-cols-1 sm:grid-cols-2 gap-4 dupcheck-split min-w-0"
                : "min-w-0 overflow-hidden"
            }
          >
            <div
              className={`space-y-4 min-w-0${dupCheckOpen ? " max-h-[35vh] sm:max-h-none overflow-y-auto dupcheck-form-col" : ""}`}
            >
              {/* Top header: customer-data warnings — shown near customer area.
                The chip itself is the only click target — clicking it opens
                the customer-edit section. No duplicate buttons; the existing
                "✏️ Bearbeiten" link inside the customer card and
                "Kunde aktualisieren" save button inside the edit section
                handle all other actions. */}
              {(() => {
                if (historicalOfferCustomerLocked) return null;
                const cust = dialogOfferCustomer;
                // Only real missing billing-customer fields belong in this warning.
                // Execution-site or intake review flags must not appear as
                // "Kundendaten prüfen" when the customer master is complete.
                const missingData = !cust || isCustomerDataIncomplete(cust);
                if (!missingData) return null;
                return (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => openCustomerEditor()}
                      className="tap-safe inline-flex items-center gap-1.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-md"
                      aria-label="Kundendaten ergänzen — öffnet den Kunde-bearbeiten-Bereich"
                    >
                      {missingData && (
                        <MissingCustomerDataBadge variant="standard" />
                      )}
                    </button>
                  </div>
                );
              })()}
              {/* Customer Info / Select / Edit */}
              <div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-1 gap-1">
                  <div className="flex items-center gap-2">
                    <Label>Kunde *</Label>
                    {historicalOfferCustomerLocked && (
                      <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        Historischer Kundenstand
                      </span>
                    )}
                  </div>
                  {!showNewCustomer &&
                    form.customerId &&
                    !historicalOfferCustomerLocked && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                        onClick={() => openCustomerEditor()}
                      >
                        ✏️ Bearbeiten
                      </button>
                      <button
                        className="text-xs text-amber-600 hover:underline flex items-center gap-1"
                        onClick={() => setDupCheckOpen(true)}
                      >
                        🔍 Duplikate prüfen
                      </button>
                    </div>
                  )}
                </div>
                {!showNewCustomer ? (
                  <>
                    {editOfferId && form.customerId ? (
                      (() => {
                        const cust = dialogOfferCustomer;
                        if (!cust) return null;
                        // Required fields: name/address/plz/city — painted red when missing.
                        // Optional fields: phone/email — always neutral (black), never red.
                        const reqMiss = isRequiredCustomerFieldMissing;
                        return (
                          <div
                            role={historicalOfferCustomerLocked ? undefined : "button"}
                            tabIndex={historicalOfferCustomerLocked ? undefined : 0}
                            onClick={
                              historicalOfferCustomerLocked
                                ? undefined
                                : () => openCustomerEditor()
                            }
                            onKeyDown={
                              historicalOfferCustomerLocked
                                ? undefined
                                : (e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      openCustomerEditor();
                                    }
                                  }
                            }
                            title={
                              historicalOfferCustomerLocked
                                ? "Historischer Kundenstand"
                                : "Kunde bearbeiten"
                            }
                            aria-label={
                              historicalOfferCustomerLocked
                                ? "Historischer Kundenstand"
                                : "Kunde bearbeiten"
                            }
                            className={`rounded-xl border border-slate-200 bg-slate-50/70 p-2 sm:p-3 space-y-1.5 min-w-0 transition-colors dark:border-slate-700 dark:bg-slate-900/30 ${
                              historicalOfferCustomerLocked
                                ? "cursor-default"
                                : "cursor-pointer hover:bg-slate-100/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
                            }`}
                          >
                            {isFallbackCustomerName(cust.name) ? (
                              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                <span className="text-sm font-semibold truncate text-amber-600 dark:text-amber-400">
                                  ⚠️ Kunde noch nicht zugeordnet
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  (bitte echten Kunden zuweisen)
                                </span>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-sm font-semibold">
                                    👤 {cust.customerNumber || ""}
                                    {cust.customerNumber ? " · " : ""}
                                  </span>
                                  <span
                                    className={`text-sm font-semibold ${reqMiss(cust.name) ? "text-red-500 border-b border-red-400 border-dashed pb-0.5 italic" : ""}`}
                                  >
                                    {cust.name || "Name fehlt"}
                                  </span>
                                </div>
                                <div className="grid grid-cols-1 gap-1 text-xs">
                                  <div
                                    className={`flex items-center gap-1 ${reqMiss(cust.address) ? "text-red-500" : "text-foreground/70"}`}
                                  >
                                    <span className="font-medium w-16 shrink-0">
                                      Strasse:
                                    </span>
                                    <span
                                      className={
                                        reqMiss(cust.address)
                                          ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                          : ""
                                      }
                                    >
                                      {cust.address || "fehlt"}
                                    </span>
                                  </div>
                                  <div className="flex gap-3">
                                    <div
                                      className={`flex items-center gap-1 ${reqMiss(cust.plz) ? "text-red-500" : "text-foreground/70"}`}
                                    >
                                      <span className="font-medium w-16 shrink-0">
                                        PLZ:
                                      </span>
                                      <span
                                        className={
                                          reqMiss(cust.plz)
                                            ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                            : ""
                                        }
                                      >
                                        {cust.plz || "fehlt"}
                                      </span>
                                    </div>
                                    <div
                                      className={`flex items-center gap-1 ${reqMiss(cust.city) ? "text-red-500" : "text-foreground/70"}`}
                                    >
                                      <span className="font-medium shrink-0">
                                        Ort:
                                      </span>
                                      <span
                                        className={
                                          reqMiss(cust.city)
                                            ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                            : ""
                                        }
                                      >
                                        {cust.city || "fehlt"}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 text-foreground/70">
                                    <span className="font-medium w-16 shrink-0">
                                      Tel:
                                    </span>
                                    <span>{cust.phone || "—"}</span>
                                  </div>
                                  <div className="flex items-center gap-1 text-foreground/70">
                                    <span className="font-medium w-16 shrink-0">
                                      E-Mail:
                                    </span>
                                    <span>{cust.email || "—"}</span>
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <CustomerSearchCombobox
                            customers={customers}
                            value={form.customerId}
                            onChange={(id) =>
                              setForm({ ...form, customerId: id })
                            }
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0 text-xs h-[38px]"
                            onClick={() => {
                              setEditingCustomer(false);
                              setNewCust({
                                name: "",
                                phone: "",
                                email: "",
                                address: "",
                                plz: "",
                                city: "",
                                country: "CH",
                              });
                              setShowNewCustomer(true);
                            }}
                          >
                            + Neuer Kunde
                          </Button>
                        </div>
                        {form.customerId &&
                          (() => {
                            const cust = dialogOfferCustomer;
                            if (!cust) return null;
                            const reqMiss = isRequiredCustomerFieldMissing;
                            return (
                              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2 sm:p-3 space-y-1.5 min-w-0 dark:border-slate-700 dark:bg-slate-900/30">
                                {isFallbackCustomerName(cust.name) ? (
                                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                    <span className="text-sm font-semibold truncate text-amber-600 dark:text-amber-400">
                                      ⚠️ Kunde noch nicht zugeordnet
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                      (bitte echten Kunden zuweisen)
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-sm font-semibold">
                                      👤 {cust.customerNumber || ""}
                                      {cust.customerNumber ? " · " : ""}
                                    </span>
                                    <span
                                      className={`text-sm font-semibold ${reqMiss(cust.name) ? "text-red-500 border-b border-red-400 border-dashed pb-0.5 italic" : ""}`}
                                    >
                                      {cust.name || "Name fehlt"}
                                    </span>
                                  </div>
                                )}
                                <div className="grid grid-cols-1 gap-1 text-xs">
                                  <div
                                    className={`flex items-center gap-1 ${reqMiss(cust.address) ? "text-red-500" : "text-foreground/70"}`}
                                  >
                                    <span className="font-medium w-16 shrink-0">
                                      Strasse:
                                    </span>
                                    <span
                                      className={
                                        reqMiss(cust.address)
                                          ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                          : ""
                                      }
                                    >
                                      {cust.address || "fehlt"}
                                    </span>
                                  </div>
                                  <div className="flex gap-3">
                                    <div
                                      className={`flex items-center gap-1 ${reqMiss(cust.plz) ? "text-red-500" : "text-foreground/70"}`}
                                    >
                                      <span className="font-medium w-16 shrink-0">
                                        PLZ:
                                      </span>
                                      <span
                                        className={
                                          reqMiss(cust.plz)
                                            ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                            : ""
                                        }
                                      >
                                        {cust.plz || "fehlt"}
                                      </span>
                                    </div>
                                    <div
                                      className={`flex items-center gap-1 ${reqMiss(cust.city) ? "text-red-500" : "text-foreground/70"}`}
                                    >
                                      <span className="font-medium shrink-0">
                                        Ort:
                                      </span>
                                      <span
                                        className={
                                          reqMiss(cust.city)
                                            ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                            : ""
                                        }
                                      >
                                        {cust.city || "fehlt"}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 text-foreground/70">
                                    <span className="font-medium w-16 shrink-0">
                                      Tel:
                                    </span>
                                    <span>{cust.phone || "—"}</span>
                                  </div>
                                  <div className="flex items-center gap-1 text-foreground/70">
                                    <span className="font-medium w-16 shrink-0">
                                      E-Mail:
                                    </span>
                                    <span>{cust.email || "—"}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                      </>
                    )}
                  </>
                ) : (
                  <div
                    ref={customerEditorRef}
                    className="rounded-xl border p-2 sm:p-3 space-y-2 bg-slate-50/70 dark:bg-slate-900/30 border-slate-200 dark:border-slate-700 min-w-0"
                  >
                    <p className="text-xs font-semibold text-muted-foreground">
                      {editingCustomer
                        ? "✏️ Kunde bearbeiten"
                        : "➕ Neuer Kunde erstellen"}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Name *</Label>
                        <Input
                          placeholder="Name"
                          value={newCust.name}
                          onChange={(e) =>
                            setNewCust({ ...newCust, name: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Telefon</Label>
                        <Input
                          placeholder="Telefon"
                          value={newCust.phone}
                          onChange={(e) =>
                            setNewCust({ ...newCust, phone: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Strasse + Hausnr. *</Label>
                      <Input
                        placeholder="Strasse + Hausnr."
                        value={newCust.address}
                        onChange={(e) =>
                          setNewCust({ ...newCust, address: e.target.value })
                        }
                      />
                    </div>
                    {/* Paket N + O: shared Land/PLZ/Ort input with country-aware autocomplete. */}
                    <PlzOrtInput
                      country={newCust.country}
                      onCountryChange={(country) =>
                        setNewCust({ ...newCust, country })
                      }
                      plzValue={newCust.plz}
                      ortValue={newCust.city}
                      onPlzChange={(plz) => setNewCust({ ...newCust, plz })}
                      onOrtChange={(city) => setNewCust({ ...newCust, city })}
                      onBothChange={(plz, city) =>
                        setNewCust({ ...newCust, plz, city })
                      }
                      required
                      compact
                    />
                    <div>
                      <Label className="text-xs">E-Mail</Label>
                      <Input
                        placeholder="E-Mail"
                        value={newCust.email}
                        onChange={(e) =>
                          setNewCust({ ...newCust, email: e.target.value })
                        }
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={saveCustomer}
                        disabled={savingCust}
                      >
                        {savingCust
                          ? "Speichern..."
                          : editingCustomer
                            ? "Kunde aktualisieren"
                            : "Kunde erstellen"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDupCheckOpen(true)}
                      >
                        🔍 Duplikate prüfen
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setShowNewCustomer(false);
                          setEditingCustomer(false);
                        }}
                      >
                        Zurück zum Angebot
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              {/* Form fields — collapsed when dupCheck open */}
              {dupCheckOpen ? (
                <div className="p-2 bg-muted/40 rounded border border-dashed text-xs text-muted-foreground flex items-center justify-between">
                  <span>
                    {items?.filter((i: OfferItem) => i.description).length || 0}{" "}
                    Leistung(en) · {formatCurrency(total, currency)} ·{" "}
                    {form.offerDate || "—"} · {form.status}
                  </span>
                  <span className="text-[10px] italic">
                    Duplikat-Prüfung aktiv — Form eingeklappt
                  </span>
                </div>
              ) : (
                <>
                  <div
                    ref={executionAddressRef}
                    className="scroll-mt-20 rounded-xl border border-cyan-200 bg-cyan-50/40 p-2.5 sm:p-3 dark:border-cyan-900/60 dark:bg-cyan-950/20"
                  >
                    <div
                      role={executionSites.length > 0 ? "button" : undefined}
                      tabIndex={executionSites.length > 0 ? 0 : -1}
                      onClick={(event) => {
                        const target = event.target as HTMLElement;
                        if (target.closest("button,input,select,textarea,a")) return;
                        toggleOfferExecutionAddressEditor();
                      }}
                      onKeyDown={(event) => {
                        if (
                          executionSites.length > 0 &&
                          (event.key === "Enter" || event.key === " ")
                        ) {
                          event.preventDefault();
                          toggleOfferExecutionAddressEditor();
                        }
                      }}
                      className={`-m-1 grid grid-cols-1 gap-2 rounded-lg p-1.5 outline-none transition-colors sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start ${
                        executionSites.length > 0
                          ? "cursor-pointer hover:bg-cyan-100/80 focus-visible:ring-2 focus-visible:ring-cyan-400 dark:hover:bg-cyan-900/30"
                          : ""
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-slate-400"
                          checked={executionSites.length > 0}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) =>
                            setExecutionAddressEnabled(event.target.checked)
                          }
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold leading-5">
                            Ausführungsadresse abweichend von Rechnungsadresse
                          </span>
                          <span className="block max-w-2xl text-xs leading-4 text-muted-foreground">
                            Nur aktivieren, wenn die Arbeit an einem anderen Ort ausgeführt wird.
                          </span>
                        </span>
                      </div>
                      {executionSites.length > 0 && !editingExecutionAddress && (
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 w-full justify-start px-2 text-xs sm:w-auto"
                            onClick={addExecutionSite}
                            disabled={saving}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            Arbeitsort hinzufügen
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 w-full justify-start px-2 text-xs sm:w-auto"
                            onClick={() => setEditingExecutionAddress(true)}
                            disabled={saving}
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5" />
                            Bearbeiten
                          </Button>
                        </div>
                      )}
                    </div>

                    {executionSites.length === 0 ? (
                      <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-background px-3 py-2 text-sm text-muted-foreground">
                        Die Rechnungsadresse gilt auch als Ausführungsadresse.
                      </div>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {executionSites.map((site, index) => (
                          <div
                            key={`${site.sourceOrderId || "site"}-${index}`}
                            className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950"
                          >
                            {editingExecutionAddress ? (
                              <div className="space-y-3">
                                <div>
                                  <Label className="text-xs">
                                    Objekt / Bereich
                                  </Label>
                                  <Input
                                    value={site.siteName || ""}
                                    placeholder="z.B. Wohnpark Limmat, Serverraum"
                                    onChange={(event) =>
                                      updateExecutionSite(
                                        index,
                                        "siteName",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs">
                                    Strasse + Hausnummer
                                  </Label>
                                  <Input
                                    value={site.siteAddress || ""}
                                    placeholder="Strasse + Hausnummer"
                                    onChange={(event) =>
                                      updateExecutionSite(
                                        index,
                                        "siteAddress",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </div>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr]">
                                  <div>
                                    <Label className="text-xs">PLZ</Label>
                                    <Input
                                      value={site.sitePlz || ""}
                                      placeholder="PLZ"
                                      onChange={(event) =>
                                        updateExecutionSite(
                                          index,
                                          "sitePlz",
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs">Ort</Label>
                                    <Input
                                      value={site.siteCity || ""}
                                      placeholder="Ort"
                                      onChange={(event) =>
                                        updateExecutionSite(
                                          index,
                                          "siteCity",
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </div>
                                </div>
                                <div>
                                  <Label className="text-xs">
                                    Hinweis zum Ausführungsort
                                  </Label>
                                  <Input
                                    value={site.siteNote || ""}
                                    placeholder="Optionaler interner Hinweis"
                                    onChange={(event) =>
                                      updateExecutionSite(
                                        index,
                                        "siteNote",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-start gap-2">
                                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-semibold">
                                    {site.siteName ||
                                      (executionSites.length > 1
                                        ? `Ausführungsort ${index + 1}`
                                        : "Ausführungsadresse")}
                                  </div>
                                  <div className="mt-1 grid grid-cols-[74px_1fr] gap-x-2 gap-y-1 text-sm">
                                    <span className="text-muted-foreground">
                                      Strasse:
                                    </span>
                                    <span className="break-words">
                                      {site.siteAddress || "–"}
                                    </span>
                                    <span className="text-muted-foreground">
                                      PLZ / Ort:
                                    </span>
                                    <span className="break-words">
                                      {[site.sitePlz, site.siteCity]
                                        .filter(Boolean)
                                        .join(" ") || "–"}
                                    </span>
                                    {site.siteNote && (
                                      <>
                                        <span className="text-muted-foreground">
                                          Hinweis:
                                        </span>
                                        <span className="break-words">
                                          {site.siteNote}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                        {editingExecutionAddress && (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={addExecutionSite}
                              disabled={saving}
                            >
                              <Plus className="mr-1 h-3.5 w-3.5" />
                              Arbeitsort hinzufügen
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={saveOfferExecutionAddress}
                              disabled={saving}
                            >
                              {saving ? "Speichern..." : "Adresse speichern"}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div
                    ref={serviceItemsRef}
                    tabIndex={-1}
                    className="scroll-mt-24 space-y-2 rounded-xl border bg-background p-2.5 outline-none focus:ring-2 focus:ring-amber-300/60 sm:p-3"
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label className="whitespace-nowrap text-base font-semibold">
                          {executionSites.length > 1
                            ? "Arbeitsorte & Leistungen"
                            : `Leistungen · ${items.filter((item: OfferItem) => String(item?.description || "").trim()).length} *`}
                        </Label>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {executionSites.length > 1 && (
                            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={toggleAllOfferSites}>
                              {expandedOfferSiteKeys.size === groupOfferItemsByExecutionSite(items || [], executionSites).length ? "Übersicht" : "Alle öffnen"}
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={addItem}
                            className="h-7 shrink-0 px-2 text-xs"
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            Leistung hinzufügen
                          </Button>
                        </div>
                      </div>
                      {executionSites.length > 1 ? (
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span className="min-w-0 truncate">
                            {executionSites.length} Arbeitsorte · {items.filter((item: OfferItem) => String(item?.description || "").trim()).length} Leistungen
                          </span>
                          <span className="shrink-0 font-mono font-medium text-foreground">
                            {formatCurrency(subtotal, currency)}
                          </span>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Kompakte Übersicht. Zum Bearbeiten die Leistung aufklappen.
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      {(() => {
                        const groups = groupOfferItemsByExecutionSite(items || [], executionSites);
                        const renderEntries = (
                          entries: Array<{ item: OfferItem; index: number }>,
                        ) =>
                          entries.map(({ item, index: idx }) => {
                        const lineTotal =
                          Number(item?.unitPrice ?? 0) *
                          Number(item?.quantity ?? 0);
                        const matchedService = (services || []).find(
                          (service: any) =>
                            normalizeOfferHint(service?.name) ===
                            normalizeOfferHint(item?.description),
                        );
                        const catalogPrice = Number(
                          matchedService?.defaultPrice ?? 0,
                        );
                        const catalogUnit = String(
                          matchedService?.unit ?? "",
                        ).trim();
                        const samePrice =
                          !matchedService ||
                          Math.abs(
                            Number(item?.unitPrice ?? 0) - catalogPrice,
                          ) < 0.001;
                        const sameUnit =
                          !matchedService ||
                          !catalogUnit ||
                          String(item?.unit ?? "").trim() === catalogUnit;
                        const hasCriticalReview =
                          !String(item?.description || "").trim() ||
                          Number(item?.unitPrice ?? 0) <= 0 ||
                          Number(item?.quantity ?? 0) <= 0 ||
                          !String(item?.unit || "").trim() ||
                          /(?:prüfen|pruefen|prufen)/i.test(String(item?.unit || ""));
                        const itemNeedsReview =
                          hasCriticalReview ||
                          !matchedService ||
                          !samePrice ||
                          !sameUnit;
                        const itemReviewReasonV17_90L134 =
                          getOfferServiceReviewReasonV17_90L134(
                            item,
                            services || [],
                          ) || (itemNeedsReview ? "Manuell prüfen" : "");
                        const isMenuOpen = serviceActionMenuIndex === idx;

                        const isExpanded = expandedItemIndex === idx;

                        return (
                          <div
                            key={idx}
                            data-service-item-index={idx}
                            className={`relative overflow-visible rounded-xl border transition-colors ${
                              hasCriticalReview
                                ? "border-red-300 bg-red-50/20 dark:border-red-800/70 dark:bg-red-950/10"
                                : itemNeedsReview
                                  ? "border-amber-300 bg-amber-50/30 dark:border-amber-800/70 dark:bg-amber-950/10"
                                  : "border-slate-200 bg-background dark:border-slate-700"
                            }`}
                          >
                            <div
                              className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2.5 transition-colors ${
                                isExpanded ? "rounded-t-xl" : "rounded-xl"
                              } ${
                                hasCriticalReview
                                  ? "hover:bg-red-100/70 dark:hover:bg-red-900/25"
                                  : itemNeedsReview
                                    ? "hover:bg-amber-100/70 dark:hover:bg-amber-900/25"
                                    : "hover:bg-slate-100/80 dark:hover:bg-slate-800/60"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedItemIndex((current) =>
                                    current === idx ? null : idx,
                                  );
                                  setServiceActionMenuIndex(null);
                                }}
                                className="min-w-0 text-left"
                              >
                                <div className="min-w-0">
                                  <span className="block truncate font-medium">
                                    {item?.description || "Neue Leistung"}
                                  </span>
                                </div>
                                <div className="mt-0.5 grid min-w-0 grid-cols-1 items-center gap-x-8 gap-y-1 sm:grid-cols-[17rem_auto]">
                                  <div className="truncate text-xs text-muted-foreground">
                                    {Number(item?.quantity ?? 0) > 0
                                      ? item.quantity
                                      : "prüfen"}{" "}
                                    {item?.unit || "Einheit prüfen"} ×{" "}
                                    {Number(item?.unitPrice ?? 0) > 0
                                      ? formatCurrency(
                                          Number(item.unitPrice),
                                          currency,
                                        )
                                      : "Preis prüfen"}
                                  </div>
                                  {itemNeedsReview && (
                                    <span className="inline-flex min-w-0 max-w-[12rem] items-center overflow-hidden border-l border-slate-200 pl-3 dark:border-slate-700">
                                      <span
                                        title={itemReviewReasonV17_90L134}
                                        className={`max-w-full truncate whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                          hasCriticalReview
                                            ? "border-red-300 bg-red-100 text-red-800"
                                            : "border-amber-300 bg-amber-100 text-amber-800"
                                        }`}
                                      >
                                        {itemReviewReasonV17_90L134}
                                      </span>
                                    </span>
                                  )}
                                </div>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedItemIndex((current) =>
                                    current === idx ? null : idx,
                                  );
                                  setServiceActionMenuIndex(null);
                                }}
                                className="flex items-center gap-2 whitespace-nowrap"
                              >
                                <span className="font-mono font-semibold">
                                  {formatCurrency(lineTotal, currency)}
                                </span>
                                <ChevronDown
                                  className={`h-4 w-4 text-muted-foreground transition-transform ${
                                    isExpanded ? "rotate-180" : ""
                                  }`}
                                />
                              </button>

                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setServiceActionMenuIndex((current) =>
                                      current === idx ? null : idx,
                                    );
                                  }}
                                  className="rounded-md border border-slate-200 bg-background p-1.5 text-slate-600 hover:bg-muted"
                                  title="Aktionen"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </button>

                                {isMenuOpen && (
                                  <div
                                    onClick={(event) => event.stopPropagation()}
                                    className="absolute bottom-full right-0 z-50 mb-1 w-60 rounded-md border bg-background py-1 text-sm shadow-xl"
                                  >
                                    {String(item?.description || "").trim() && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          saveOfferItemToServices(idx)
                                        }
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
                                      >
                                        <Plus className="h-3.5 w-3.5" />
                                        In Leistungskatalog übernehmen
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        removeItem(idx);
                                        setServiceActionMenuIndex(null);
                                      }}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      Löschen
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="space-y-3 border-t border-slate-200 bg-background p-3 dark:border-slate-700">
                                {executionSites.length > 1 && (
                                  <div className="rounded-lg border border-cyan-200 bg-cyan-50/60 p-2">
                                    <Label className="text-xs">Arbeitsort</Label>
                                    <select
                                      className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                      value={
                                        executionSites.findIndex(
                                          (site) => offerSiteKey(site) === offerSiteKey(item),
                                        ) >= 0
                                          ? offerGroupKeyForSite(
                                              executionSites[
                                                executionSites.findIndex(
                                                  (site) => offerSiteKey(site) === offerSiteKey(item),
                                                )
                                              ],
                                            )
                                          : ""
                                      }
                                      onChange={(event) =>
                                        assignOfferItemToSite(idx, event.target.value)
                                      }
                                    >
                                      <option value="">Arbeitsort wählen…</option>
                                      {executionSites.map((site, siteIndex) => {
                                        const key = offerGroupKeyForSite(site);
                                        return (
                                          <option key={`${key}-${siteIndex}`} value={key}>
                                            {siteIndex + 1}. {site.siteName || site.siteAddress || "Neuer Arbeitsort"}
                                          </option>
                                        );
                                      })}
                                    </select>
                                  </div>
                                )}
                                <ServiceCombobox
                                  value={item?.description ?? ""}
                                  services={services as ServiceOption[]}
                                  onChange={(name, service) =>
                                    onItemServiceSelect(idx, name, service)
                                  }
                                  onServiceCreated={handleServiceCreated}
                                  currentPrice={
                                    item?.unitPrice != null
                                      ? String(item.unitPrice)
                                      : undefined
                                  }
                                  currentUnit={item?.unit}
                                  contextLabel="Angebot"
                                  showManualHint={false}
                                  saveButtonPlacement="none"
                                />

                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                  <div>
                                    <Label className="text-xs">Einheit</Label>
                                    <select
                                      className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                      value={item?.unit ?? ""}
                                      onChange={(event) =>
                                        updateItem(
                                          idx,
                                          "unit",
                                          event.target.value,
                                        )
                                      }
                                    >
                                      <option value="">Einheit prüfen</option>
                                      <option value="Stunde">Stunde</option>
                                      <option value="Tag">Tag</option>
                                      <option value="Pauschal">Pauschal</option>
                                      <option value="Meter">Meter</option>
                                      <option value="Quadratmeter">Quadratmeter</option>
                                      <option value="Kubikmeter">Kubikmeter</option>
                                      <option value="Stück">Stück</option>
                                      <option value="Räume">Räume</option>
                                      <option value="Kilogramm">Kilogramm</option>
                                      <option value="Tonne">Tonne</option>
                                      <option value="Liter">Liter</option>
                                    </select>
                                  </div>
                                  <div>
                                    <Label className="text-xs">Menge</Label>
                                    <Input
                                      type="number"
                                      step="0.25"
                                      placeholder="prüfen"
                                      className={`h-9 ${
                                        Number(item?.quantity ?? 0) <= 0
                                          ? "border-red-500 bg-red-50"
                                          : ""
                                      }`}
                                      value={
                                        Number(item?.quantity ?? 0) <= 0
                                          ? ""
                                          : (item?.quantity ?? "")
                                      }
                                      onChange={(event) =>
                                        updateItem(
                                          idx,
                                          "quantity",
                                          event.target.value || "0",
                                        )
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs">
                                      Preis ({currency})
                                    </Label>
                                    <Input
                                      type="number"
                                      step="0.05"
                                      placeholder="prüfen"
                                      className={`h-9 ${
                                        Number(item?.unitPrice ?? 0) <= 0
                                          ? "border-red-500 bg-red-50"
                                          : ""
                                      }`}
                                      value={
                                        Number(item?.unitPrice ?? 0) <= 0
                                          ? ""
                                          : (item?.unitPrice ?? "")
                                      }
                                      onChange={(event) =>
                                        updateItem(
                                          idx,
                                          "unitPrice",
                                          event.target.value || "0",
                                        )
                                      }
                                    />
                                  </div>
                                </div>

                                {item?.description?.trim() && itemNeedsReview && (
                                  <div
                                    className={`rounded-lg border px-3 py-2 text-xs ${
                                      hasCriticalReview
                                        ? "border-red-300 bg-red-100/70 text-red-900"
                                        : "border-amber-300 bg-amber-100/60 text-amber-900"
                                    }`}
                                  >
                                    <div className="font-semibold">
                                      {hasCriticalReview
                                        ? "Preis/Menge prüfen"
                                        : "Manuell prüfen"}
                                    </div>
                                    {!matchedService ? (
                                      <div className="mt-1">
                                        Nicht im Leistungskatalog. Optional über das Drei-Punkte-Menü übernehmen.
                                      </div>
                                    ) : (
                                      <div className="mt-1 space-y-0.5">
                                        <div>
                                          Katalog: {catalogUnit || "—"} ·{" "}
                                          {formatCurrency(catalogPrice, currency)}
                                        </div>
                                        {!sameUnit && (
                                          <div>Einheit weicht vom Katalog ab.</div>
                                        )}
                                        {!samePrice && (
                                          <div>Preis weicht vom Katalog ab.</div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                                                });

                        if (groups.length <= 1) {
                          return renderEntries(groups[0]?.entries || []);
                        }

                        return groups.map((group, groupIndex) => (
                          <details
                            key={group.key}
                            open={expandedOfferSiteKeys.has(group.key)}
                            onToggle={(event) => {
                              const open = event.currentTarget.open;
                              setExpandedOfferSiteKeys((current) => {
                                const next = new Set(current);
                                if (open) next.add(group.key);
                                else next.delete(group.key);
                                return next;
                              });
                            }}
                            className="overflow-visible space-y-1.5"
                          >
                            <summary
                              className={`flex cursor-pointer list-none items-center justify-between gap-3 border-2 border-cyan-400 bg-cyan-100/75 px-3 py-2.5 transition-colors hover:bg-cyan-200/70 dark:border-cyan-800 dark:bg-cyan-950/25 dark:hover:bg-cyan-900/35 [&::-webkit-details-marker]:hidden ${
                                expandedOfferSiteKeys.has(group.key)
                                  ? "rounded-t-xl rounded-b-none border-b-0"
                                  : "rounded-xl"
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">
                                  📍 {groupIndex + 1}. {group.site?.siteName || group.site?.siteAddress || `Ausführungsort ${groupIndex + 1}`}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                  {[group.site?.siteAddress, [group.site?.sitePlz, group.site?.siteCity].filter(Boolean).join(" ")]
                                    .filter(Boolean)
                                    .join(" · ") || "Adresse nicht angegeben"}
                                </div>
                                {(() => {
                                  const groupSummary = buildOfferServiceReviewSummary(
                                    {
                                      items: group.entries.map((entry) => entry.item),
                                    } as Offer,
                                    services || [],
                                    currency,
                                  );
                                  if (
                                    groupSummary.reviewCount === 0 &&
                                    groupSummary.blockerCount === 0
                                  )
                                    return null;
                                  return (
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                      {groupSummary.reviewCount > 0 && (
                                        <span
                                          className="relative inline-flex max-w-[12rem] items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900"
                                          role="button"
                                          tabIndex={0}
                                          onClick={(event) => event.stopPropagation()}
                                          onPointerDown={(event) => event.stopPropagation()}
                                        >
                                          <span className="truncate whitespace-nowrap">
                                            Leistungen prüfen · {groupSummary.reviewCount}
                                          </span>
                                          <OfferServiceReviewTooltip
                                            title={`Leistungen prüfen · ${groupSummary.reviewCount}`}
                                            sections={groupSummary.reviewSections}
                                            align="left"
                                          />
                                        </span>
                                      )}
                                      {groupSummary.blockerCount > 0 && (
                                        <span
                                          className="relative inline-flex max-w-[12rem] items-center gap-1 rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800"
                                          role="button"
                                          tabIndex={0}
                                          onClick={(event) => event.stopPropagation()}
                                          onPointerDown={(event) => event.stopPropagation()}
                                        >
                                          <AlertTriangle className="h-3 w-3 shrink-0" />
                                          <span className="truncate whitespace-nowrap">
                                            Angebot prüfen · {groupSummary.blockerCount}
                                          </span>
                                          <OfferServiceReviewTooltip
                                            title={`Angebot prüfen · ${groupSummary.blockerCount}`}
                                            sections={groupSummary.blockerSections}
                                            align="left"
                                          />
                                        </span>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-[10px] text-muted-foreground">
                                  {group.entries.length} Leistungen
                                </div>
                                <div className="font-mono text-sm font-bold text-emerald-700">
                                  {formatCurrency(group.subtotal, currency)}
                                </div>
                                <button
                                  type="button"
                                  className="mt-1 text-[11px] font-medium text-emerald-700 hover:underline"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setEditingOfferSiteKey((current) => current === group.key ? null : group.key);
                                    setExpandedOfferSiteKeys((current) => new Set([...current, group.key]));
                                  }}
                                >
                                  Arbeitsort bearbeiten
                                </button>
                              </div>
                            </summary>
                            {editingOfferSiteKey === group.key && group.site && (
                              <div className="ml-2 grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-background p-3 sm:grid-cols-2">
                                <div className="sm:col-span-2"><Label className="text-xs">Objekt / Bereich</Label><Input value={group.site.siteName || ""} onChange={(event) => updateOfferGroupSite(group.key, "siteName", event.target.value)} /></div>
                                <div className="sm:col-span-2"><Label className="text-xs">Strasse</Label><Input value={group.site.siteAddress || ""} onChange={(event) => updateOfferGroupSite(group.key, "siteAddress", event.target.value)} /></div>
                                <div><Label className="text-xs">PLZ</Label><Input value={group.site.sitePlz || ""} onChange={(event) => updateOfferGroupSite(group.key, "sitePlz", event.target.value)} /></div>
                                <div><Label className="text-xs">Ort</Label><Input value={group.site.siteCity || ""} onChange={(event) => updateOfferGroupSite(group.key, "siteCity", event.target.value)} /></div>
                                <div className="sm:col-span-2 flex flex-wrap justify-end gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                    onClick={() => removeOfferExecutionSite(group.key)}
                                  >
                                    Arbeitsort löschen
                                  </Button>
                                  <Button type="button" size="sm" variant="outline" onClick={() => setEditingOfferSiteKey(null)}>
                                    Fertig
                                  </Button>
                                </div>
                              </div>
                            )}
                            <div className="ml-2 space-y-2 bg-background pt-1">
                              {renderEntries(group.entries)}
                            </div>
                          </details>
                        ));
                      })()}
                    </div>
                  </div>

                  <div className="space-y-4 border-t-4 border-slate-300 pt-4">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-base font-semibold">
                        Angebotsdaten & Betrag
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        Klar getrennt von den Leistungen
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                      <div>
                        <Label>Angebotsdatum</Label>
                        <Input
                          type="date"
                          value={form.offerDate}
                          onChange={(event) =>
                            setForm({ ...form, offerDate: event.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label>Gültig (Tage)</Label>
                        <Input
                          type="number"
                          min="0"
                          value={form.validDays}
                          onChange={(event) =>
                            setForm({ ...form, validDays: event.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label>Status</Label>
                        <select
                          className="flex w-full rounded-md border border-input px-3 py-2 text-sm"
                          style={getStatusStyle(
                            OFFER_STATUS_STYLES,
                            form.status,
                          )}
                          value={form.status}
                          onChange={(event) =>
                            setForm({ ...form, status: event.target.value })
                          }
                        >
                          {offerStatuses.map((status) => (
                            <option
                              key={status}
                              style={getStatusStyle(
                                OFFER_STATUS_STYLES,
                                status,
                              )}
                            >
                              {status}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label>Währung</Label>
                        <select
                          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          value={currency}
                          onChange={(event) =>
                            setCurrency(
                              event.target.value === "EUR" ? "EUR" : "CHF",
                            )
                          }
                        >
                          <option value="CHF">CHF</option>
                          <option value="EUR">EUR</option>
                        </select>
                      </div>
                    </div>

                    <div className="min-w-0 space-y-3 rounded-xl border-2 border-slate-400 bg-slate-100/90 p-2 sm:p-4 dark:border-slate-700 dark:bg-slate-900/70">
                      <MwStControl vatRate={vatRate} onChange={setVatRate} />
                      <div className="min-w-0 space-y-1 border-t border-slate-300 pt-2 text-xs sm:text-sm">
                        <div className="flex min-w-0 justify-between">
                          <span className="shrink-0">Netto</span>
                          <span className="font-mono">
                            {formatCurrency(subtotal, currency)}
                          </span>
                        </div>
                        {vatRate > 0 && (
                          <div className="flex min-w-0 justify-between">
                            <span className="shrink-0">MwSt. {vatRate}%</span>
                            <span className="font-mono">
                              {formatCurrency(vatAmount, currency)}
                            </span>
                          </div>
                        )}
                        <div className="flex min-w-0 justify-between border-t-2 border-slate-300 pt-2 text-sm font-bold sm:text-base">
                          <span className="shrink-0">Total</span>
                          <span className="font-mono text-primary">
                            {formatCurrency(total, currency)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border bg-background p-2 sm:p-3">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setDialogOpen(false)}
                          disabled={saving}
                          className="order-3 w-full lg:order-1 lg:w-auto"
                        >
                          Abbrechen
                        </Button>

                        <div className="order-1 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:order-2 lg:min-w-[650px]">
                          <Button
                            type="button"
                            onClick={save}
                            disabled={saving}
                            className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                          >
                            {saving
                              ? "Speichere..."
                              : editOfferId
                                ? "Speichern"
                                : "Angebot erstellen"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={saveAndClose}
                            disabled={saving}
                            className="w-full border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          >
                            {editOfferId
                              ? "Speichern & schließen"
                              : "Erstellen & schließen"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={saveAndCreateInvoice}
                            disabled={saving}
                            className="w-full border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          >
                            <FileText className="mr-1.5 h-4 w-4" />
                            → Rechnung
                          </Button>
                        </div>
                      </div>
                    </div>

                  <div className="space-y-3 rounded-xl border-2 border-slate-300 bg-background p-3 sm:p-4">
                    <div>
                      <Label className="font-semibold">
                        Text für Angebot / PDF
                      </Label>
                      <div className="text-xs text-muted-foreground">
                        Nur für den Kunden sichtbar. Beide Felder sind optional.
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Titel im Angebots-PDF</Label>
                      <Input
                        placeholder="z.B. Zusätzliche Informationen"
                        value={form.pdfTitle}
                        onChange={(event) =>
                          setForm({ ...form, pdfTitle: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Text im Angebots-PDF</Label>
                      <textarea
                        className="flex min-h-[105px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
                        rows={5}
                        placeholder="Optionaler Einleitungstext, Hinweis oder Zusatz für das Angebots-PDF..."
                        value={form.notes}
                        onChange={(event) =>
                          setForm({ ...form, notes: event.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div
                    ref={offerDetailsRef}
                    tabIndex={-1}
                    className="scroll-mt-24 space-y-3 rounded-xl border-2 border-slate-300 bg-background p-3 outline-none focus:ring-2 focus:ring-amber-300/60 sm:p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Label className="font-semibold">Besonderheiten</Label>
                        {linkedSafetyWarnings.length > 0 && (
                          <Badge className="border border-red-300 bg-red-100 text-red-700">
                            Gefahr / Achtung
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Intern – nicht automatisch im Kunden-PDF
                      </span>
                    </div>

                    {linkedPrimaryHints.length > 0 && (
                      <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
                        <div className="mb-1 flex items-center gap-2 font-semibold"><Info className="h-4 w-4" /> Wichtige Informationen</div>
                        <div className="space-y-1">
                          {linkedPrimaryHints.map((line, index) => (
                            <div key={`${line}-${index}`} className="whitespace-pre-wrap break-words">{line}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    {linkedSafetyWarnings.length > 0 && (
                      <div className="space-y-1 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                        <div className="flex items-center gap-2 font-semibold">
                          <AlertTriangle className="h-4 w-4" />
                          Wichtige Gefahren / Warnhinweise
                        </div>
                        <ul className="list-disc pl-5">
                          {linkedSafetyWarnings.map((line, index) => (
                            <li key={`${line}-${index}`}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {linkedJobHints.length > 0 && (
                      <div className="rounded-lg border border-yellow-300 bg-yellow-50/70 p-3 text-sm text-slate-900">
                        <div className="mb-2 font-semibold">
                          Weitere Besonderheiten
                        </div>
                        <div className="space-y-1 leading-7">
                          {linkedJobHints.map((line, index) => (
                            <div
                              key={`${line}-${index}`}
                              className="whitespace-pre-wrap break-words"
                            >
                              {line}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="font-semibold">Leistungsübersicht</div>
                          <div className="text-xs text-muted-foreground">
                            Live aus den Leistungen oben
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setServiceOverviewOpen((current) => !current)}
                          className="h-7 w-full px-2 text-[11px] sm:w-auto"
                        >
                          {serviceOverviewOpen ? "Einklappen" : "Anzeigen"}
                        </Button>
                      </div>

                      {!serviceOverviewOpen && (
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          <span>
                            {items.filter((item: OfferItem) =>
                              String(item?.description || "").trim(),
                            ).length}{" "}
                            Leistungen
                          </span>
                          <span className="font-mono font-semibold text-foreground">
                            {formatCurrency(subtotal, currency)}
                          </span>
                        </div>
                      )}

                      {serviceOverviewOpen && (
                        <div className="mt-2 overflow-x-auto rounded-lg border-2 border-slate-300 dark:border-slate-700">
                          <table className="w-full min-w-[680px] border-collapse text-[13px] leading-snug">
                            <thead className="bg-slate-50 text-left dark:bg-slate-900/70">
                              <tr className="border-b border-slate-300 dark:border-slate-700">
                                <th className="w-12 px-2 py-1.5 font-semibold">Nr.</th>
                                <th className="px-2 py-1.5 font-semibold">Leistung</th>
                                <th className="w-32 px-2 py-1.5 font-semibold">Einheit</th>
                                <th className="w-20 px-2 py-1.5 text-right font-semibold">Menge</th>
                                <th className="w-32 px-2 py-1.5 text-right font-semibold">Einzelpreis</th>
                                <th className="w-32 px-2 py-1.5 text-right font-semibold">Summe</th>
                              </tr>
                            </thead>
                            <tbody>
                              {items
                                .filter((item: OfferItem) =>
                                  String(item?.description || "").trim(),
                                )
                                .map((item: OfferItem, index: number) => {
                                  const quantity = Number(item?.quantity ?? 0);
                                  const unitPrice = Number(item?.unitPrice ?? 0);
                                  return (
                                    <tr
                                      key={`offer-overview-${index}`}
                                      className="border-b border-slate-200 last:border-b-0 dark:border-slate-800"
                                    >
                                      <td className="px-2 py-1.5 align-top">{index + 1}</td>
                                      <td className="px-2 py-1.5 align-top font-medium">
                                        {item.description}
                                      </td>
                                      <td className="px-2 py-1.5 align-top">
                                        {String(item.unit || "–")}
                                      </td>
                                      <td className="px-2 py-1.5 text-right align-top font-mono">
                                        {Number.isFinite(quantity) ? quantity : 0}
                                      </td>
                                      <td className="px-2 py-1.5 text-right align-top font-mono">
                                        {formatCurrency(
                                          Number.isFinite(unitPrice) ? unitPrice : 0,
                                          currency,
                                        )}
                                      </td>
                                      <td className="px-2 py-1.5 text-right align-top font-mono">
                                        {formatCurrency(
                                          (Number.isFinite(quantity) ? quantity : 0) *
                                            (Number.isFinite(unitPrice) ? unitPrice : 0),
                                          currency,
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                            </tbody>
                            <tfoot>
                              <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold dark:border-slate-700 dark:bg-slate-900/70">
                                <td colSpan={5} className="px-2 py-2">
                                  Gesamt
                                </td>
                                <td className="px-2 py-2 text-right font-mono text-emerald-700 dark:text-emerald-300">
                                  {formatCurrency(subtotal, currency)}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>

                    {linkedOrderMessages.length > 1 ? (
                      <details className="rounded-xl border bg-muted/10" open>
                        <summary className="cursor-pointer list-none px-3 py-2 font-semibold [&::-webkit-details-marker]:hidden">
                          Kundennachrichten · {linkedOrderMessages.length}
                        </summary>
                        <div className="max-h-[32rem] space-y-3 overflow-y-auto border-t p-3">
                          {linkedOrderMessages.map((message, messageIndex) => {
                            const sites = Array.isArray(message.workSites)
                              ? [...message.workSites].sort(
                                  (a, b) =>
                                    Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)) ||
                                    Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0),
                                )
                              : [];
                            const title =
                              sites[0]?.siteName ||
                              message.siteName ||
                              `Quellauftrag ${messageIndex + 1}`;
                            return (
                              <div key={`${message.id || "message"}-${messageIndex}`} className="rounded-lg border bg-background p-3">
                                <div className="mb-2 font-semibold text-sky-800">
                                  {messageIndex + 1}. {title}
                                </div>
                                <CommunicationBlock
                                  data={message}
                                  showChips={false}
                                  showSpecialNotes={false}
                                  showCustomerMessage
                                />
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    ) : linkedOrderData ? (
                      <CommunicationBlock
                        data={linkedOrderData}
                        showChips={false}
                        showSpecialNotes={false}
                        showCustomerMessage
                      />
                    ) : null}
                  </div>
                </>
              )}

            </div>
            {/* Duplicate Check Panel (right column) */}
            {dupCheckOpen &&
              form.customerId &&
              (() => {
                const cust = customers.find(
                  (c: Customer) => c.id === form.customerId,
                );
                if (!cust) return null;
                return (
                  <DuplicateCheckPanel
                    customer={{
                      id: cust.id,
                      customerNumber: cust.customerNumber,
                      name: cust.name,
                      address: cust.address,
                      plz: cust.plz,
                      city: cust.city,
                      phone: cust.phone,
                      email: cust.email,
                      country: cust.country,
                    }}
                    onClose={() => setDupCheckOpen(false)}
                    activeFormName={newCust.name}
                    activeFormAddress={newCust.address}
                    activeFormCity={newCust.city}
                    activeFormPlz={newCust.plz}
                    onApplyPlzSuggestion={(plz) =>
                      setNewCust((p: any) => ({ ...p, plz: plz ?? "" }))
                    }
                    onTakeoverCustomer={async (match: DuplicateMatch) => {
                      if (!editOfferId) return;
                      const oldCustomerId = form.customerId; // capture before overwrite
                      const res = await fetch(`/api/offers/${editOfferId}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ customerId: match.id }),
                      });
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        toast.error(err?.error || "Fehler beim Kunden-Wechsel");
                        return;
                      }
                      setForm((f: any) => ({ ...f, customerId: match.id }));
                      setNewCust({
                        name: (match.name ?? "") as string,
                        address: (match.address ?? "") as string,
                        plz: (match.plz ?? "") as string,
                        city: (match.city ?? "") as string,
                        phone: (match.phone ?? "") as string,
                        email: (match.email ?? "") as string,
                        country: "CH",
                      });
                      setCustomers((prev: Customer[]) => {
                        const exists = prev.some((c) => c.id === match.id);
                        if (exists) return prev;
                        return [
                          ...prev,
                          {
                            id: match.id,
                            name: match.name,
                            customerNumber: match.customerNumber ?? null,
                            address: match.address ?? null,
                            plz: match.plz ?? null,
                            city: match.city ?? null,
                            phone: match.phone ?? null,
                            email: match.email ?? null,
                          } as Customer,
                        ];
                      });
                      setOffers((prev: Offer[]) =>
                        prev.map((o) =>
                          o.id === editOfferId
                            ? {
                                ...o,
                                customerId: match.id,
                                customer: {
                                  name: match.name,
                                  customerNumber: match.customerNumber,
                                  address: match.address,
                                  plz: match.plz,
                                  city: match.city,
                                  phone: match.phone,
                                  email: match.email,
                                },
                              }
                            : o,
                        ),
                      );
                      setShowNewCustomer(false);
                      setEditingCustomer(false);
                      setDupCheckOpen(false);
                      toast.success(
                        `Kunde übernommen: ${match.customerNumber ? match.customerNumber + " · " : ""}${match.name}`,
                      );
                      // Fire-and-forget: cleanup old customer if it has no remaining active docs
                      if (oldCustomerId && oldCustomerId !== match.id) {
                        fetch(
                          `/api/customers/${oldCustomerId}/cleanup-after-takeover`,
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ keptCustomerId: match.id }),
                          },
                        )
                          .then((r) => r.json())
                          .then((res) => {
                            if (res?.cleaned) {
                              setCustomers((prev: Customer[]) =>
                                prev.filter((c) => c.id !== oldCustomerId),
                              );
                            }
                          })
                          .catch(() => {
                            /* silent — non-critical */
                          });
                      }
                    }}
                    onMergeComplete={async (r) => {
                      setForm((f: any) => ({
                        ...f,
                        customerId: r.survivingCustomerId,
                      }));
                      // Stage F – Critical bug fix:
                      // Replace local `newCust` form state with the freshly
                      // merged customer so the visible "Kunde bearbeiten" form
                      // shows the user-selected values immediately.
                      if (r.mergedCustomer) {
                        const m = r.mergedCustomer;
                        setNewCust({
                          name: (m.name ?? "") as string,
                          phone: (m.phone ?? "") as string,
                          email: (m.email ?? "") as string,
                          address: (m.address ?? "") as string,
                          plz: (m.plz ?? "") as string,
                          city: (m.city ?? "") as string,
                          country: (m.country ?? "CH") as string,
                        });
                        setCustomers((prev) => {
                          const exists = prev.some(
                            (c: Customer) => c.id === m.id,
                          );
                          const merged = { ...m } as any;
                          if (exists)
                            return prev.map((c: Customer) =>
                              c.id === m.id ? { ...c, ...merged } : c,
                            );
                          return [...prev, merged as Customer];
                        });
                        setOffers((prev) =>
                          prev.map((o: any) =>
                            o.customerId === m.id
                              ? { ...o, customer: { ...o.customer, ...m } }
                              : o,
                          ),
                        );
                        setEditingCustomer(true);
                        setShowNewCustomer(true);
                      }
                      await load();
                    }}
                  />
                );
              })()}
          </div>
          {/* The edit dialog keeps its existing document actions.
              List navigation is handled by the fixed process buttons. */}
        </DialogContent>
      </Dialog>

      {/* Catalog decision dialog — same conscious choice as in orders */}
      <Dialog
        open={!!catalogDecision}
        onOpenChange={(open) => {
          if (!open && !catalogDecisionSaving) setCatalogDecision(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Leistung im Katalog vorhanden</DialogTitle>
          </DialogHeader>
          {catalogDecision && (
            <div className="space-y-4">
              <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-950">
                <div className="font-semibold">
                  {catalogDecision.existing.name} existiert bereits im Leistungskatalog.
                </div>
                <div className="mt-1">
                  Entscheide bewusst, ob dieses Angebot unverändert bleibt oder der Standard im Leistungskatalog global angepasst wird.
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border bg-background p-3">
                  <div className="font-medium text-muted-foreground">
                    Katalog aktuell
                  </div>
                  <div className="mt-1 font-semibold">
                    {catalogDecision.existing.unit}
                  </div>
                  <div className="font-mono text-lg font-bold">
                    {formatCurrency(
                      Number(catalogDecision.existing.defaultPrice || 0),
                      currency,
                    )}
                  </div>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <div className="font-medium text-muted-foreground">
                    Dieses Angebot
                  </div>
                  <div className="mt-1 font-semibold">
                    {catalogDecision.unit}
                  </div>
                  <div className="font-mono text-lg font-bold">
                    {formatCurrency(catalogDecision.price, currency)}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Button
                  type="button"
                  className="w-full"
                  disabled={catalogDecisionSaving}
                  onClick={() => {
                    setCatalogDecision(null);
                    toast.info("Angebotswert bleibt unverändert");
                  }}
                >
                  Nur dieses Angebot unverändert lassen
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={catalogDecisionSaving}
                  onClick={updateOfferCatalogFromDecision}
                >
                  {catalogDecisionSaving
                    ? "Aktualisiere ..."
                    : "Katalogpreis global aktualisieren"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={catalogDecisionSaving}
                  onClick={() => setCatalogDecision(null)}
                >
                  Abbrechen
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Media Playback Dialog */}
      {/* Audio dialog */}
      <Dialog
        open={mediaDialogOpen && mediaType === "audio"}
        onOpenChange={setMediaDialogOpen}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Sprachnachricht</DialogTitle>
          </DialogHeader>
          {mediaUrl && (
            <audio controls className="w-full" src={mediaUrl}>
              <track kind="captions" />
            </audio>
          )}
        </DialogContent>
      </Dialog>
      {/* Image viewer with touch zoom/pan */}
      <TouchImageViewer
        open={mediaDialogOpen && mediaType === "image"}
        onOpenChange={setMediaDialogOpen}
        urls={galleryUrls}
        initialIndex={galleryIdx}
      />

      {/* Confirm action dialog */}
      <Dialog
        open={!!confirmDialog}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirmDialog?.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmDialog?.message}
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDialog(null)}
            >
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                const action = confirmDialog?.action;
                setConfirmDialog(null);
                await action?.();
              }}
            >
              Bestätigen
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

