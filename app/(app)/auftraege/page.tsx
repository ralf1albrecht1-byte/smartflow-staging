"use client";
// SMARTFLOW_V17_90L311B_CLEAN_NEW_SERVICE_WORKSITE_UI_VERIFIED_ALL3
// SMARTFLOW_V17_90L311_CLEAN_NEW_SERVICE_WORKSITE_UI_ALL3
// SMARTFLOW_V17_90L310_YELLOW_SERVICE_CATALOG_MENU_ALL3
// SMARTFLOW_V17_90L307_WORKSITE_PROFILE_TWO_CHOICE_ONLY_ALL3
// SMARTFLOW_V17_90L306B_WORKSITE_PROFILE_THREE_CHOICE_UI_UNIQUE_ALL3
// SMARTFLOW_V17_90L302C_WORKSITE_ID_SAFE_SAVE_VERIFIED_ALL3

import { createPortal } from "react-dom";
// CARD_BADGE_SPLIT_FINAL_V8
import {
  type ComponentType,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import MergeOrdersDialog from "@/components/orders/MergeOrdersDialog";
import {
  ClipboardList,
  Plus,
  Trash2,
  Search,
  Loader2,
  AlertTriangle,
  Info,
  FileText,
  FileCheck,
  Volume2,
  ImageIcon,
  Mail,
  MapPin,
  KeyRound,
  Phone,
  CalendarDays,
  DoorOpen,
  ParkingCircle,
  MessageCircle,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Mic,
  Pencil,
  X,
} from "lucide-react";
import { TouchImageViewer } from "@/components/touch-image-viewer";
import {
  CommunicationBlock,
  CommunicationChips,
  ContactActionChip,
  formatMergedContactReviewTooltip,
} from "@/components/communication-block";
import { MergedContactReviewChip } from "@/components/merged-contact-review-chip";
import {
  collectMergedAppointmentEntries,
  formatMergedAppointmentChipLabel,
  formatMergedAppointmentTooltip,
} from "@/lib/merged-appointment-utils";
import { ServiceCombobox, ServiceOption } from "@/components/service-combobox";
import {
  mergeCustomerIntoForm,
  isFallbackCustomerName,
} from "@/lib/customer-form";
import { extractDocumentContactFallback } from "@/lib/document-contact-fallback";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { formatCurrency } from "@/lib/currency";
import {
  DuplicateCheckPanel,
  type DuplicateMatch,
} from "@/components/customer-duplicate-check";
import {
  buildSpecialNotes,
  splitSpecialNotes,
  detectCallbackRequest,
  classifySpecialNoteRoleV17_90L93,
} from "@/lib/special-notes-utils";
import { extractExecutionAddressFromText } from "@/lib/order-intake-validation";
import { fetchAllJSON } from "@/lib/fetch-utils";
import { LoadErrorFallback } from "@/components/load-error-fallback";
import { ORDER_STATUS_STYLES, getStatusStyle } from "@/lib/status-colors";
import { useDialogBackGuard } from "@/lib/use-dialog-back-guard";
import {
  isCustomerDataIncomplete,
  isRequiredCustomerFieldMissing,
} from "@/lib/customer-links";
import { MwStControl } from "@/components/mwst-control";
import { PlzOrtInput } from "@/components/plz-ort-input";
import { CustomerSearchCombobox } from "@/components/customer-search-combobox";
import { AutoReuseBanner } from "@/components/auto-reuse-banner";
import { MissingCustomerDataBadge } from "@/components/missing-customer-data-badge";
import {
  canonicalAppointmentBadgeV2,
  canonicalCommunicationDataV2,
  canonicalOrderInfoV2,
  getCanonicalIntakeV2,
  isIntakeV2Order,
} from "@/lib/intake-v2/view";
import { canonicalLinesV2 } from "@/lib/intake-v2/schema";

const SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227 =
  "smartflow:close-card-popovers-v17-90l227";

const NORMAL_DOG_ICON_DATA_URI =
  "data:image/webp;base64,UklGRp4FAABXRUJQVlA4IJIFAABwIwCdASqyALQAPp1OokylpKMiJPRo2LATiWVu3/mx/91/W/7VMEy/hqD4e03G3hN6maJwa0tDSAqV+WKL8sWDC/ovT3RzgsGbS1gsOrAzRo/IqfkFJWrJKh0jj8YAah0glBAjsNbH42Q5JZX5G7cNdLzIlhg923q5PxxZrKv7bcotpS2sXv7FA75LQt07jQu/nukNC828w9w1OHrFSVqIVPxQI0RsA8P83rY/HxHvxauFyifoT9x1ka06q9oxcXBv8IeJ+Mt7IwnFJ+ZiIGsyAqwvc3MvXk9+d6tNYJ3dlzMQJhIUC451NKSxQwTqGtGx/f8a9ur0Hd//Wc3jB70PEedjnDA35tF4tZNblppkHd8EVQgU98Z7I0su5Nblsx1oisCgAP749EAABIoD/cGOkADimWmQwB51m3A5e/sk3ic7U09skMzjzSwyRGvG3gfUW14xUGUKBfI+I7d6xJ8IWWhppMwiErdLAyk++GDDcmt9Dx+V9lOak0MCJvy+MHmLx8tE22W6hZR3R71K9QRCU9spfDylb+Iq57qTnp8vWSOxRvT9joZu98v8PLF8uJlbWivbRjuTSOMnqof4fjGC5Ub0Bw4/W1A14DWb5QMe/L72TM9vT3gflzMBWV0rPc8pyUDduoXdr0P88x13+r3lEMztc3L2I6b6AvCsIFTtFWSPemIcUR0e4C9/zDdHWSfOVCBYzcjO74E01JJcnv4XmnWahfIdEASTUxCjAp7W90dMJXheRcQMMxxTh2CWY1bv+pGUlSixn1maVqWGbDrGmBRgOJ69kT/rBdXDkkJRDBH6IIZ/X8mN7dnLo5FiuazA72z1qhdvVyjODTylJDuCfOLq4RyPZTI6yzzHU0OOsfqsu59agUFCy2fVh34AYCy6m7XIGjyEIqmjRxT4kC35jgmW5ai49A2Q3pF2EeHblIftDK/4Jop7AHD2avKldxjZcXdGLPzua0alwnR2CeOIWaI1ulEr9ZHbtnKva+oym4HObjV5CL52bdMgo3RObPyPtoWb0ehLkgmQ+vCHzsi+NP5vq18TARiV84Tr66VtDf1p47dbOW0ZHd4IBwU46n8BUvTHsQE5VIto3js7T8Ub2yPf1JQssqktwN+sA5IxNCf4FyZBcoCEHh7ZZNNuC1VbKTeweAaP01gooB7Bb8AOJ72wCqZfn5AoR+R+Sr9QyUIkziQdi9d21OVYUrJe1gprpu3Gvi/4ay/av3WLOIihizzvicQjTvruzsNuM6iokXi5mfKpS7A2W+NmT6rBU163I1aIQyHvGCJPGk8YaXZB7bJ2ExrNf6nFs3RMHaL4w7GHbaEjcUX/Qw+ONfYotG9toGCb3kcrjl5/zgJTnha2R79xQ0RYqRA3snEr8rd4+due22TZfa4947vj2A14yDYFMFdiTor9+jTxix8CabNUdwbClB33KEPJMGjMopLnbAmH8aprvro21A9PhkypZShHBdAlIimm0OMXNb+/ll7JHzTSP8rx8yv+dDzAoh2bAR0dkNytRmTSlgO+t5e0z65oiZ8xQwuUgMJzdRplkonAQONltuD/YSWTUAYP0ntWVeeweOxDAf+PPS3K9YDRdMopInq+USzBLlB5FIeZKeomYs1mk5tHjqMPbvceEMW8KlzGY+8eIuya1VlKn1DbWIpavUOkPZN5irm0i4xd4X9bW+gmRylnYtzFUlERRHu2JPeGuHaXMz6dDU5o+i5djtxcnGnRyyytRdoyBaO5ptndzJmYpqSDTgiJAhiL9mf6sVU6WyJ41lJ6602oDci+cxu1S5h8qWJyoGl+treWjYPmJm7UGSkMrApZyzSlAxnDB85iB0YW+E2UpuvGDyf6IZCN+vZwXblYr17dXoAa4YBz0WTXTh8VHn4zIYSYAAAAAAAA";
const DANGEROUS_DOG_ICON_DATA_URI =
  "data:image/webp;base64,UklGRiweAABXRUJQVlA4ICAeAADwpgCdASosAWgBPp1Kn0qlpKMiJdLbsLATiWVu4W/Q8F/dkF9BJLTP91/ceINPNbF/4/rC3BOgu9WP6LnTSfuXhl/+m86vk1lsrx8L9CvPf2q8AvI7tGgCfX/z9/xfPH+N/1OuS0BP5//pfWY/4fMV9jcDExwQ5tnhzbPDm2eHNs8ObZ4c2zw5tnhzbPDm2cFcBG2+yyP+Snwqa/kf901I10cNJub6Tc30lRFDqfd4Dsi+CuYkxP3hHyiQGCdK9pDNsZlvQfAojDceR0PMjoeMYDrYZ4SpkxZdBgbHhs1W/ZNDXeSozJ0YaGxMwTiwvbHawAdDzI6HE35XJqcu9HdpDjzGpZvMuaE4oFRqv+HOT1ZECIItJUrYVycWiHsuOlu9Kvq+rEJDH8Ll6yxBqovM5Cthgh9f1ApTceX+WVfPhdlfB5WA+aUY4lfRbtN4cbR5d1loQ+X8vlbYTjoF7GCXS3EjXtuWpzm5HHWt1C4dCRAfoxRwd7pATUQ2lpc+sC4fgMNEN92R8hc3V/bQ//XXxulNN/gbYNEmBDL1092B++TLz9Cq6hkpqU4rxhrpIrkp9QxFv0rNuS9f49dP9WbIQbxcvdtle3f0e25sGMOIZZKROfHaACVSngFIGcK7iOjaSXZL6ZjWnAn0TG14us20S132hZdzQnesX0809RU0MgCv0GdI77tbAf5TNxD7oPQUpOyXYnXhmFNRqirrMZwmb7QPJ9Ijyx0MFcWs6AOCSKHTDxBqvQjO5upKKjlxug5LwsMAxK48rTxjyprgohv8Bm9xyu9HPEW79TIlYUfetLJ9gxL/kVxyyxVUQRZwHTF7sBpfZybcC5pjTxFfwRuFRcRNzMIZBEf5Wr+iC6HNzXQQbPRlywCxUXaxOBE5yrPsfVFkWI0fxDICeIoL1vfQ22v1h3oPwzfIuBGrPwG9QGxJw0Hlibihc1Ke6b6Pl6vAziITvIFbu2PdWsEJDAsf2Ma2U2eocLsjGrwu+cqz6uqL7Xg0qfgHUe9xvSaYTVMU9iKW6MFbGyTltjgzr8a38bOkM9I5lPjd3X8h8jlbUAJD8Gkgb5UBf/qgtK4TpuLwXCa4OjWRfRYpSe5B0A1/OgfcSO1FbTP9U3U36HHTVxVYnXEtAxuqrTTRfJvaI9hOwuUUKQWZJcZ2C5ebAzNkXWXHibL9xAdkRGbJFTVceMQV5eznwBSqQ8pBbnRjhpb2yfk3OKIoxpwmp/tuIndp5cgWTqd+DArhw98D/j7/diP+0S+YYzmC58ejOfxA1en/wbPBI84QgcM4zt0D/T3nXaq4djMSmxS/8tbzftPrIVC8ZvWC+CaWV3GuqSpmk4WSO4P06R87Uaq4C/cpXrHay2rWDoiuRNOM/yJyFFu8LHDvqmE/sxXUVC5do97Ke6Uv8VZaTUpCVK5MaNpIWFxorw9xJEwi+RfiG29YWbPJVHYxpHQqAeYdE5xe6lHwOq1oAa5/9FVgI2kRTitg6s8mxv7dMUl9gX3yfA3K+PKaF+8QXMelkxaG29KUckgi29CIpVub0k/JPSSIXE6Z0dgzziYMohOdmoOVHFolHb3EEQhyqXy3HFoGOTqzxpeZztzyqWI1us2N4D/9PKpos4TATavbu9MDrMQvn2FbVuTHhJLa7AwmHextdb0oAuk0D6+WVHq9Jq3dCOJchLzbTdS/WrScGGA18WIZTgT/Yu58WdhtXifuX0Qzhv6gP8LbMJU7llYvxCFJJmUT7LZX/hGXEmeVz7lFRp0ri2zw5tnhzbPDm2eHNs8ObZ4c2zw5tVAA/v6t0AAAAAH9H5ezPVPcP+tMyM+E0pMB8y+Q+ZjBAix5aWt8H5doLslZRp4UQTjpuxnNaVeqK0Uc9ePB2EIKlKej0FAtPO9E0zGKqIGQhD68p+MnZxbD+/1GzxaAeqe4AhTrAjrGS/e5lYiO5cokDm/KH0Gu+ghdyqOk/kIVrHTDjt/KPV3VizDbSowOGlonNUm0qkyLsguOUhmY5cQK7LnO5jdoYdngxVImzXpRawRrnuchH4KVy5L/dDX00LbvBA4id79i5nsEYUb/ewEB8LSBoZVGXJD9ntCjdKpr+RfCTEYEyFeUV+URK6CWvuGpkqy8AgQG9i563DsbnDGpYP7+c5+jrKBkeo8kmBxgOZGpUUTX5/NPBPzMqbYjCQAwlnsQS7JLDplCXzk3OXyKSQgn9s7aEMcFmJW0E6umaczSbocMqoPweMQ8u1DOhStPZnL87BXdUBr12KFPQHqzYolRrU4MEbhgBTCo175dp1IREG78LV/oMv4clb41iicUO1u0RZ2XIamoNfaPuuk32aDaLoM+ogRe0gi2aZEbOH2JPoDM+zuFpVl1It3JYmOkeyKauzZFakY3TVdwx97/yJdSHXhEvIYHOjgahQLVrZmguv7QH7Yv5vkRd399vkdL5ZHDxtEBiii39oZjb49Bn83L8DA9Orn9cupwLlH4MK7nBzasCIAWYRSNLX3BOyPm0cZd5qgqEoGCu8ivKvakxq9HrXakKV+4LrhkiNxIsWFs6X1H+Ya4MaiajsPIhxI2KfcIBPcLKtjDJG8glYcnoWk5yUSD3bYuL5R58IJPxnii4k06ROSR6EucnWXZTZVAkkk1Dd75caM7dEvvU/uwlwHLjTAImUkLi09HSaBaV1IolrJwEosYvPTpVtA2nzP5R6fmTilv4YDd8qYfQzzSNdTEihd6FRffFLHuQsvA3TUzPTVcGZGmJIaGgH+KH13NrkYjcWLl3RY3DK4VKahvR5oNzUVoFUSGPNIW13xjhyL/av4vDsuE75pKCG8OSX5pQWQnPruyCeYepQX5RGS2lAwF4ujWLIfw6mhgextWrVh8GIQ3qenBt7djV8J4ZQFwKlsrJTXm7hiFcyWsFyuFvLNyWIjZclzpcBl35QQU+CeXSCLhD7J+jTSEwG0n2WkUTnfpBXpwgV8j1jmMwevrtKYiwiulfYs4VIiQ8Sx6qySFTliCcy/5jdcdvgD9JWwIXqW6WlhXnxVmuwHzkfWlcXOcX0BqlnXDq+pxQlSEqe6x0WfgPNUNke4xM0fOZ5V071JjlNZdlhUT0QJmrozdVVNIKb70GywCzICbFdhOpxiky/+wY6TIDRl87UboUwt83xlqZo4i4a81DYaQewJCbr9q0fdytJ29+oeuweYwnXL/uCImitYcuL88JZ6P52+/QcO/wi3ZH/R2cKbpqJs/kycoTUXfS9bpXBJUGytlS5XrdtCoEyTAzzGoF5F4N1833f18eu78kj3g/g6sb7n0knyk6H4FHxLUa9XuJXAQGzHJPDLXPZo3E+/N9mLQtDBw1iTUfA5K/xv/c5rgonYusMyl/4dLCZKXLTK0yFppKFydX/HAotrMQ7Of50UPzRvwHyN/Li5pVhZo+N6m29qafhO69pavWJUwUMb4aglZeCvAHOEQPAM8UgVMEgUStOdrTEtnWztpSbyfrM554uYx5lQPic223DnY7e+RuF6WbJvjTDNZDl5/LlGfdyBHqkAvCnXZrBTLwuWsYVJGU9zJVX0swUD+UpZsvW72Ena5g5nhTXzDZZoA1/rFLBt8XWbh5p00SlKFQAA4aa5NlASyAq61siTlfSRIRSamEyinWLkPswfObrVOYNUYfXelZ1cItTax8q0gIHcvW3y+INQ0kPyEZIgbgs/SRT4d3X1uy3sVJdFE4+dCAouwRvkVRzMCB3L1U/p6Pe7I84rds+5nSIMNTiVRNJk890GwX/bndjryuKvIn+5eJWtPbCnAS5YezJ8mEd0ErVzZM2LMg7RmU160DGltrUXVJgQYOY4oSa+AWs5+eUD1xNSJqtqWtQKbNKxGX/7UsETSz/2g6Bb7p0KEyPdOWmYeAZo6swZX3uVJBN+h9DIj+GV0ksmDh56bPXfT8iDOBqqmQ7v4WQm1Y+Pn5f8q7d/09YYMfjtdxwmN3/MrUFNWDgyIB2eB3mlpHK2VVQr/y3bryVMds3KMrPu1rTmB56ryxjIy6SQLi5SHw5KGwh/3WaP5apWmarCtDVJsH3yuPxOaMqCTTq3mb1KdPYAjM0q9XB1fQso/8i9+GtIRlMHiduUbVMahpxongCgKAmtENt6GzVDS/kKIwVk8XPJfbk+JrSujPTndw12rl2/nudQd7l57irv4X7x5/4+w8IalbcJ3H8EQDEKDn2aUqhN5kC9vISoZ4CqPzcU2bZ3qsEG/1JW44B8aFpb2sJ8MeI8jTq2/Z8q9I8qM7GX652L71s1p85s9HCY9URls4ZYVgC6t9sAhgogotYDuX77gCk8jJmh5Y/iirZ0JD9YZXCK74sSAuxIBdeIF3Thqw1KR4MFbGjwBLOMfsOuDjj4Zlw3rlWdEs1brrCzMiFjf8fabUzVGvR0bNUrVMWua8rqHunxN8l1PNIsOOjr9zQXqcW0sO4fibUXbv9X4ZbqOHiVoPNnY/hzHSJvnmUQss+OcObibiFCLlwolbkyO1O7pAoVgyVoWhKbwii+9jzlcnBH4v4mB24AVq7LzGEoeDQAOmKWMFRLU99fRyG3ebCIDPbeSbQYWrUYYofgvOtAnkJObHXls4Ba7Yc2xNdO7/XjffxrUBFy8GJYgM87CJ5OCZx02wtJQ8kp3MUCsjYWMA0c/OKMKW62+FO9spwuBs5mN8EizkOnrAEV5qJ+JwXuk9bKFYkNLvG5eZqniXGDRSDmp53O6icFDcD36nBRUW1OqIhTshYHJ0qpkb08QgKSZoJ6zX2gmt54mAQLWvCW5KtON8fp/5kk/MkzoCUwYbWUfceoFAiVFA25AMGiSfAAzvKg5LtUP2PJWBMiaYj8+FHlcEN3SGGf540DB8SZAMfvcDT686D8KivqS1mB0vCrr1DoT6fHt40rYDEQYi4Xvkyh205EJjF1x065CpatV5h2j4gWt3j/uoXZIJ42EikIgEzEk5kLjE9J9SEGBlzV1ErQTYBIWkvzxMNUmWy4uxSYXx8QaXnbCSX6N3rak/YON/NwO19kmH2tnf4T+Y1ZWZWvrRgcKHJKqHO4w1nM8XJvsuXDdshtxmI8LHV3zr6/8MEKc+ANpFWbDoAfbRI02pwnD4sYtrPzlQeJbPfGrFBIPqksA7U2FjqdYBaijrGIb3d8TUFDjS4xx+64d54Vkcj3xx9HyTzShjmd7I2qJD4QvgBCR3SWd1NyMTWi8uKGtpqN5ndNzld1aztpieT+twh/rrg2IGenCVsWXJHUIE+tl29RMxE3PbaH3mwMPc2pt5AAikE37pW56FqjPhIrArqEv73i4aCVDKzLmib9Yv7ho8kVSEDjD1/1m0iLl0eHqWk8xXziwaiZE5EckluxCSkps6vtdmweccPoYRA6hA7KHuqIu8YcqOBaw/j6QyoaB1Al0ALfbxTtlkH4lAqtA8OlfqD4XHONaL3uynUbCmku0shTHceuYNXNxdJnnNlgYudXrNyOgeP9WcsGwTye9pbWzxvxjC5dSM75HBpN4/5ejysBXJIVsC4v1aghfZY6X09awNVbMIDcgvlEVPEsFztSB3R8HqlYwTXw3xqnY9Me4HWDGmgAYfCf1vZO58D2yW6hibYiS2tc03vMZLl1AdfCHDZBtKBzr764ykPPWOBDGkx2ANSW4TuCLt16Xdaqi6idIIWM4MFS5Z2u2C9yWirbGB0FU0X7MvQcajl+xOSwSXlMclpJR6Aq1EcrF56UO3gjusV45UOF9rF6fbELpxuFxQ2KYWp2n1MuHD9M37thHlT4mVe0CkIh2QkCrtSR4cepL/2XTEErZpVq6D1H72Q+Cu8l5bKRUwRlgs8HgroC0O++nnZYGjsL2YZ1fJS9GLrW07iYyPd36l4L5Karuar8wjewMtRb9BoT3tqztAtgrkU8yxj4BbZ7vQ9r5sPYnxXjouvb8XItOE9c/7SFCrK7kXbPVf8P7bSvmbTIeRzpVa5hBhaiRFzrMJCw55eNFDQ/76DGZne8WPzveZO8XdoU6E+4P9BELZ0W2OqPwLyHUJ4wUwYF9gE0ZBfp4zHCSTHNX5UD4/O836NT6Ek4CYo7k1V+UoikEC4tF371Z5hhKpRFKTDs7ObT+ibnEQiwA6BFRBiTF563QSVtuJSROP2gDQWkeb7yTxhAM6n7WNiEtIPI/mqQ+Gnz55FUbzDw5eY/65k0hqh/W8XYMx5Q4Zow7gVgik2U62yzA/sewNWdV7zRzlXLndUEtn3nux7zX7aRwYayxvMeKzwWnyJaF3KYNYHMbyhg3J6YOMebR7nzxAzS/bzNJZiLW9gNUi8kUIlYIPaR71cGt9XuSoLPcvq89BNuHpvCSn2dejnR0OCFI1mX4k4SU2+Pywj/oZ7M6JsPypDuzjSrXXfsMin9Aq18GVS+EVIWauHoan+7M7op/krGaJEwmD2P6BfEUpjvoG/6q157jpl/NbBG/ibS9p8cOuxCsfJ2TA1ZpzhHft8gmcLgfF7N0vKgtHssJD4eE+Di9XisFoWtucGxSgpqvr6m1tdF7+HdFdSC8kjtBDpuJdv43dZc8vvkutzpSjbGD2QMQB//9+1/e1Ze2BSs6jdWFU7HsTodMNaMAReVRVK8ZZMhSGR9wXqU9lIXlI2u9D+tTX4/epay8jUDPSsEwqQf5JJXDd2WtPSQhplHUOXyqpZnYXL1UfTuiz0Nj4vKlUGI6x1KDZoS84eaFMQ/JZinbU6okvXsmKMh7wm6KZYStBnUDdPztycErRbaCjOSzOLNRW0XH0zDOaTf3k1f5GruFp1zZgipL+JfQa3R8vrHtrL71kVfPCNWbSUaXpXcpt8ntr1j4SBR1EBK/e32PMj48Y54lEBYNcKCYrb2m3+VRaV40oW+yiS0dEUXASMcfQLOiLf2BUUA5er/UtV92d172gxKuEBTFs7fDbmJ2MiQUWniTBD1rwrnrycNQkXh5prtfiNNmox6fNBarv3xJ4zySlPalf6QWOIPcDhz8H7Oj07XxrBXYrad0zd/8s77OdijmL9ixEHzOj14TE0jTVdqjBCYA1GoziGndq3xG0rjfUcpcrf9tE6ia0w1cRnGyDGsGlyy7DofAW+G1ob+l5e1r6aZYX7wV2M1l3AZmRI1r5SjC1oWno7QYTRm8s677n/Vfp7c9ADVux3VDs6zP6Zz47bdC0UUvmvgGo7PJUGfe5zFYEsuz3PRl0kBuLzfmGsy46bmjQENj9JrEdpUxzEVyzCA0myKnxmvymrghyK6/Z6z2mm3KNbRQ33Qfd74YAbB5hy855m4ZqMJSmlsySpjdUDXICXL8Lz15HFSIKNtf1h24oAl1Zdf346HnkM2XtWa+BWcWbXKBaoilBtK64oOImBIb6IvgDSyLo8KkAv1CFPvBVQ1pHYpx3qp/Y/xJA/ZA4kV5DU97Zm7d9FrzqkdIuKae5hki+vdxlnra6Ow1vV44kWC1FTY/tMVR//sq4m5+zEf6KPaRET4N/1yDeBHIqm4X+fS1nc9Aa480ZcyFUG2m7C2VQGpvZlnjE+QzHUYaqKDTRib2L8ebfir8dkeiBccmW5objlrlxG9n5jyfMd37dwEuHtRm64Km2q+HnczJdHpn7HhHUyr3P8hhxL5jIZ3iJ1Pt+Qnz70aUKUS+zQd0fdiRAU15YJodItjd79CMHtbDCL6nSzSGpxdtlaeS1OKmG9cQ61Y3VwFhAIh3MIgXXj9b+hVGutRALeQ1xzqv6lC/u/K16aiV7GrlO1RP5Uph6y90Cd964ovXFiSS0jEP7QWLBjd5UIMp8P/J58ptEYe5pOp9L9zkdAmp18Zvvz6jxUqRKjuWekK6dgQkmR4C8yE4vi18qEynZ3sTTW3darai1QMFL9uhZzC85hsmn1V/wO4ToKhTAS+y00sIrLStxX4fn6a+YQcCKfGuX/L1+8FQeH7bcx5xPaan5OBMLOOxU1B0DIpEPkJ+tASd+dot8G+xTa9RPV0tKeDx8ir8VJwu2a3mGT2Dynhlj/CfHHGCT3ecDtroGigz+O9d2Gl1meFbr1QKk1H1HdsxLw++DSjPTYAMd4IvHTdSH4thOdtTjZ46B/Joj+dlxiUU1WJ/SLg3tUgvwMuilxIZ4vIWsE2yh33zG9njUQ8Gb7YNxDZseji54tItR9Rwk95wJ+y8MhgVu7CyRYlHZ7o5oK7zIQ56ODD+7npMqhzEtv3vE57gzcDzRDXA26qp+/FfnLoJBaI3CWfKeTzPEUxRm5dEM7fOEbi2qQw8x5ahCjqQ/rbhgAYI3YYYMkBT4EZNJzgeg7hWgDCYLuhPX+mXaWXyJgge0nRAD1UdDTg2cObgk0xh9slsFw0ovuairHdosmzJSsiWHS3lBrYAb8VYwFX37yNXT68SKavm37r66//jovmmc8TbKr5aTVxJS3RmaQim2I6amFp7WN0DVLg2jYbKqzg+PnvrCOW8MSCIcbjaqFI0hlfYl9V08F8FHo/jNx8uKyrsuc8RQ9grs7Q+OqHQYexVbuv+/W7/HYylm/cHldf7c0vWY6jqBkqPBQCV8Y0WHAO0uursJdxQFRGhQxrbYJareyvHAGj9UxSqZqeOPAgeaxehbuySPD32dRopzBhcvd3sQDJ7TOcQHeK8ABiTqdJkwg+5jaZA4TFSyngmoDxPS+yjt+/tEJrvfNOt/3Vobrbl915KHPLBznsr0m20lGzfq2RIh6tEX5V8qeBc0lHkmH9F+IBbN9Eyg3GEAOJNp5P9x+BRolldC6sPMdax8uQIwLGCjrWQ04Odv5ujDCIqjcUVbnyfvQ7QurpiNyG55rLC4eGkQrNGCpRlGcIjtv0+6ufEWxx2BORwsdj5T0RigXLBWA109i3+XvfUDUBWL7Ef1PscrG5Hm1+eJKysptXokIpGW+FHLejxKHYLgj1C6Ru7TLEiPEaiPKZgBjwN+tIQjOF2/cwJDOwqn5UDEleeGeAbMpqGcCrMRgZS6p12FQ26xWALYX84oIDDuSqmO+1sbUHGMZPe+IF3cJbTfutCWFw0haGhBbqKDfjxNo1ToIrWAEJOZpQdcjvmvSr73OejKF1m9e7tZCJM2MS488ATrzgDi3rORtkxLlVVZP0Lgt84649+dbZ/8PLYzBnu0VnAUslX73KU9P34Gad8OiRuX8LJVjB8bEJKE3EKOS3mCpW9cBLkJGNLqLiC34OIJzhDSDcC0A13OHBWKNsyh/X7j+j5sw3csju+qP1vH98LRCFamkSD0DnzWKCryA0R9ZKniM+UPbrV6ec+XZm/oLNkFnCeYmybGFCmP/G/chRENsEyftWWF21Ewg/6PfiSJtSyuWqatgY2PHGixPPO2Rz4EN+bfRrx2lylXlnbIYeJhdl/3i6uiX76uTx9r5e/HaHzL5M2xRd/yn9uzzMHEeBt49Y2AXCq09xnSTHnOQwlxI+ftguc3J9UMRFl/KJMwwNu74KExUljOri6PToEJTZJbWrRsYs5Rs2xspYem0wn2hBPNd0+WIHl+mjMMaxOw49cCTwlXAVWZWDHhJPLLA3E8rXWLx35fpt2GxR6E4BG9hkMXEVFp09fQkmYUegDczXv/eaqSPa7bBT2wWWPDTM5r3lak6fbanyEZwe8O60QF2d9tkiXSDv9rObg9xdNmv9Jxam/Vt6E+z4fA9S0nZJ9eRhn8ofs3CzzrZsbiVDN1ldyC6V1T0NT9TcgIttK521ZL6yeuMOYh6zrJ4A2D96TP0kVQ8mFv8NKqRbFib0qYpZTzRSVukUL9tdF8WVLClRu0wmCFxWmtHMB132PveeyegVoYL8yYRXguo56+oZpuPZJAms+EAMALPQKNC/O6y2nPEIpO10tOmm2V9eGWBIhjwGfb1dk2MoUs/ZIjwLEswn2Zg96k7Rm1CCGqPoP4nU7XC66oD+YUfze9ZdA+zG+YXqfqDlnUimdTw9sQTvB6nFqHjSLBlq7+pfEWpMcCf2YYyL7yO6FlR+3j2+k/Q6m/ZzJ1r3ZkkRvl/02sAKxyMdWCHptrGa/uoS4fpu/SzsRPgQDRdGGPeddcVpOGAH4JnVfwfMEXdTnfFYQpIuUtf+FUNRAqRQnBLDrHFVkgapPVWis3WbtvShuhfDwd8ykxYQDC5sDPl8RiGI6Vy9c8ccP+FT9qTiCSD7BAkgyQExiauC/Wm2Apff3708YvVo2zim6J8sNKAu6C2l1V6RdzWAwejkS8R2ozTIaOWZO+ZOhTS45XAa0RVlLzeffBgKjdFs1Skcxj3uNRPiYPoki5WlurXsWXS4/7gKuZgfz8cg4QPn1xjyrD1GD8maGSho1aXL9I08EBLYANMHh/JAAAAAAAAAAAA==";

function LadderIcon({
  className = "h-4 w-4",
}: {
  className?: string;
  strokeWidth?: number | string;
}) {
  return (
    <span
      className={`${className} inline-flex items-center justify-center leading-none`}
      aria-hidden="true"
    >
      🪜
    </span>
  );
}

function DogIcon({
  className = "h-4 w-4",
}: {
  className?: string;
  strokeWidth?: number | string;
}) {
  return (
    <span
      className={`${className} inline-block bg-center bg-contain bg-no-repeat align-middle`}
      style={{ backgroundImage: `url(${DANGEROUS_DOG_ICON_DATA_URI})` }}
      aria-hidden="true"
    />
  );
}

function DangerousDogIcon({
  className = "h-4 w-4",
}: {
  className?: string;
  strokeWidth?: number | string;
}) {
  return (
    <span
      className={`${className} inline-block bg-center bg-contain bg-no-repeat align-middle`}
      style={{ backgroundImage: `url(${DANGEROUS_DOG_ICON_DATA_URI})` }}
      aria-hidden="true"
    />
  );
}

function WarningEmojiIcon({
  className = "h-4 w-4",
}: {
  className?: string;
  strokeWidth?: number | string;
}) {
  return (
    <span
      className={`${className} inline-flex items-center justify-center leading-none`}
      aria-hidden="true"
    >
      ⚠️
    </span>
  );
}

function OpenDoorIcon({
  className = "h-4 w-4",
  strokeWidth = 2.2,
}: {
  className?: string;
  strokeWidth?: number | string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 21h16" />
      <path d="M6 21V4.8A1.8 1.8 0 0 1 7.8 3H17v18" />
      <path d="M10 20V6.4l7-2.1V21" />
      <path d="M14.3 13h.01" />
    </svg>
  );
}

function WhatsAppIcon({
  className = "h-4 w-4",
  strokeWidth = 2.1,
}: {
  className?: string;
  strokeWidth?: number | string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
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

function SmsIcon({
  className = "h-4 w-4",
  strokeWidth = 2.1,
}: {
  className?: string;
  strokeWidth?: number | string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 6.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z" />
      <path d="M8 12h.01" />
      <path d="M12 12h.01" />
      <path d="M16 12h.01" />
    </svg>
  );
}

interface OrderWorkSite {
  id: string;
  customerExecutionAddressId?: string | null;
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
  isPrimary?: boolean | null;
  sortOrder?: number | null;
}

interface OrderItem {
  id?: string;
  workSiteId?: string | null;
  workSite?: OrderWorkSite | null;
  serviceName: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  currency?: string | null;
  detectedCurrency?: string | null;
  needsReview?: boolean | null;
  reviewReason?: string | null;
}

interface Order {
  currency?: "CHF" | "EUR" | null;
  siteAddressDifferent?: boolean | null;
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
  id: string;
  intakeSchemaVersion?: string | null;
  intakeSnapshot?: unknown;
  customerId: string;
  description: string;
  serviceName: string | null;
  status: string;
  priceType: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  date: string;
  createdAt?: string;
  notes: string | null;
  specialNotes: string | null;
  needsReview?: boolean;
  reviewReasons?: string[] | null;
  hinweisLevel?: string;
  mediaUrl: string | null;
  mediaType: string | null;
  imageUrls?: string[];
  audioTranscript?: string | null;
  audioDurationSec?: number | null;
  audioTranscriptionStatus?: string | null;
  offerId?: string | null;
  invoiceId?: string | null;
  vatRate?: number | null;
  vatAmount?: number | null;
  total?: number | null;
  customer?: {
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    plz?: string | null;
    city?: string | null;
    customerNumber?: string | null;
  };
  workSites?: OrderWorkSite[];
  originOrderIds?: string[];
  items?: OrderItem[];
}
interface CustomerExecutionAddress {
  id: string;
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
  country?: string | null;
  usageCount?: number | null;
  lastUsedAt?: string | null;
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
  executionAddresses?: CustomerExecutionAddress[];
}
interface ServiceDef {
  id: string;
  name: string;
  defaultPrice: number;
  unit: string;
}

const statuses = ["Alle", "Offen", "Erledigt"];
const orderStatuses = ["Offen", "Erledigt"];
const statusColors: Record<string, string> = {
  Offen:
    "bg-orange-200 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200 border border-orange-300",
  Erledigt:
    "bg-green-200 text-green-900 dark:bg-green-900/40 dark:text-green-200 border border-green-300",
};

const priceTypes = [
  "Einheit prüfen",
  "Stunde",
  "Tag",
  "Pauschal",
  "Meter",
  "Quadratmeter",
  "Kubikmeter",
  "Stück",
  "Räume",
  "Kilogramm",
  "Tonne",
  "Liter",
];

const unitConflictTextByReason: Record<string, string> = {
  Menge_erkannt_aber_Leistung_basiert_auf_Stunden:
    "⚠ Menge prüfen: Fläche/Menge erkannt, aber diese Leistung ist nach Stunden hinterlegt.",
  Menge_erkannt_aber_Leistung_basiert_auf_Tagen:
    "⚠ Menge prüfen: Menge erkannt, aber diese Leistung ist nach Tagen hinterlegt.",
  Menge_erkannt_aber_Leistung_basiert_auf_Metern:
    "⚠ Menge prüfen: andere Einheit erkannt, aber diese Leistung ist nach Metern hinterlegt.",
  Menge_erkannt_aber_Leistung_basiert_auf_Quadratmetern:
    "⚠ Menge prüfen: andere Einheit erkannt, aber diese Leistung ist nach Quadratmetern hinterlegt.",
  Menge_erkannt_aber_Leistung_basiert_auf_Kubikmetern:
    "⚠ Menge prüfen: andere Einheit erkannt, aber diese Leistung ist nach Kubikmetern hinterlegt.",
  Menge_erkannt_aber_Leistung_basiert_auf_Tonnen:
    "⚠ Menge prüfen: andere Einheit erkannt, aber diese Leistung ist nach Tonnen hinterlegt.",
  Menge_erkannt_aber_Leistung_basiert_auf_Litern:
    "⚠ Menge prüfen: andere Einheit erkannt, aber diese Leistung ist nach Litern hinterlegt.",
  Menge_erkannt_aber_Leistung_basiert_auf_Kilogramm:
    "⚠ Menge prüfen: andere Einheit erkannt, aber diese Leistung ist nach Kilogramm hinterlegt.",
  Menge_erkannt_aber_Leistung_basiert_auf_Stueck:
    "⚠ Menge prüfen: andere Einheit erkannt, aber diese Leistung ist nach Stück hinterlegt.",
  Menge_erkannt_aber_Leistung_ist_pauschal:
    "⚠ Menge prüfen: Menge erkannt, aber diese Leistung ist pauschal hinterlegt.",
};

interface FormItem {
  key: string; // client-side key for React
  serviceName: string;
  unit: string;
  unitPrice: string;
  quantity: string;
  aiWarning?: string;
  catalogReviewConfirmed?: boolean;
  manualCurrencyConfirmed?: boolean;
  manualUnitConfirmed?: boolean;
  manualReviewConfirmed?: boolean;
  // V17.90L247: A red review row remains pending after the user fills the
  // fields. Only the explicit Übernehmen/Verwerfen action may resolve it.
  pendingManualReviewDecision?: boolean;
  pendingReviewSourceServiceName?: string;
  recognitionReviewKey?: string;
  sourceDescription?: string;
  workSiteId?: string | null;
  workSite?: OrderWorkSite | null;
}

const createEmptyItem = (): FormItem => ({
  key: Math.random().toString(36).slice(2),
  serviceName: "",
  unit: "Einheit prüfen",
  unitPrice: "",
  quantity: "",
  catalogReviewConfirmed: false,
  manualCurrencyConfirmed: false,
  manualUnitConfirmed: false,
  manualReviewConfirmed: false,
  pendingManualReviewDecision: false,
  pendingReviewSourceServiceName: "",
  recognitionReviewKey: "",
  workSiteId: null,
});

const AI_WARNING_PREFIX = "[AI_WARNING]";
const PRICE_REVIEW_CONFIRMED_PREFIX = "[PRICE_REVIEW_CONFIRMED]";
const MANUAL_CURRENCY_CONFIRMED_PREFIX = "[MANUAL_CURRENCY_CONFIRMED]";
const MANUAL_UNIT_CONFIRMED_PREFIX = "[MANUAL_UNIT_CONFIRMED]";
const MANUAL_REVIEW_CONFIRMED_PREFIX = "[MANUAL_REVIEW_CONFIRMED]";

const isCatalogReviewConfirmedDescription = (description?: string | null) =>
  compactText(description).startsWith(PRICE_REVIEW_CONFIRMED_PREFIX);

const getCatalogReviewConfirmedFromItemDescription = (
  description?: string | null,
) => isCatalogReviewConfirmedDescription(description);

const isManualCurrencyConfirmedDescription = (description?: string | null) =>
  compactText(description).startsWith(MANUAL_CURRENCY_CONFIRMED_PREFIX);

const getManualCurrencyConfirmedFromItemDescription = (
  description?: string | null,
) => isManualCurrencyConfirmedDescription(description);

const isManualUnitConfirmedDescription = (description?: string | null) =>
  compactText(description).startsWith(MANUAL_UNIT_CONFIRMED_PREFIX);

const getManualUnitConfirmedFromItemDescription = (
  description?: string | null,
) => isManualUnitConfirmedDescription(description);

const isManualReviewConfirmedDescription = (description?: string | null) =>
  compactText(description).startsWith(MANUAL_REVIEW_CONFIRMED_PREFIX);

const getManualReviewConfirmedFromItemDescription = (
  description?: string | null,
) => isManualReviewConfirmedDescription(description);

const getManualUnitConfirmedUnitFromItemDescription = (
  description?: string | null,
) => {
  const value = compactText(description);
  if (!value.startsWith(MANUAL_UNIT_CONFIRMED_PREFIX)) return "";
  const rest = value.replace(MANUAL_UNIT_CONFIRMED_PREFIX, "").trim();
  const match = rest.match(/^([^:]+):/);
  return compactText(match?.[1] || "");
};

const stripInternalItemDescriptionMarkers = (description?: string | null) => {
  const value = compactText(description);
  if (!value) return "";
  return value
    .replace(new RegExp(`^\\s*${PRICE_REVIEW_CONFIRMED_PREFIX}\\s*`, "i"), "")
    .replace(new RegExp(`^\\s*${AI_WARNING_PREFIX}\\s*`, "i"), "")
    .replace(new RegExp(`^\\s*${MANUAL_REVIEW_CONFIRMED_PREFIX}\\s*`, "i"), "")
    .trim();
};

const isCatalogReviewConfirmedItem = (item?: {
  description?: string | null;
  catalogReviewConfirmed?: boolean | null;
}) =>
  Boolean(item?.catalogReviewConfirmed) ||
  isCatalogReviewConfirmedDescription(item?.description);

const shouldCollapseCustomerMessagesForOrder = (order?: Order | null) => {
  if (!order) return true;

  const originCount = Array.isArray(order.originOrderIds)
    ? order.originOrderIds.filter(Boolean).length
    : 0;

  const mergedText = [order.notes, order.description]
    .filter(Boolean)
    .join("\n");

  return (
    originCount > 1 ||
    /(?:hauptauftrag|zusammengeführt\s+mit|zusammengefuehrt\s+mit|verbunden\s+von\s+auftrag)/i.test(
      mergedText,
    )
  );
};

const getAiWarningFromItemDescription = (description?: string | null) => {
  if (!description) return "";
  const value = compactText(description);
  return value.startsWith(AI_WARNING_PREFIX)
    ? value.replace(AI_WARNING_PREFIX, "").trim()
    : "";
};

const hasQuantityReviewForService = (
  reviewReasons: string[] | null | undefined,
  serviceName?: string | null,
) => {
  const name = (serviceName || "").trim().toLowerCase();
  if (!name) return false;

  return (
    reviewReasons?.some((reason) => {
      if (reason.startsWith("unit_mismatch:")) {
        const [, reasonService] = reason.split(":");
        return (reasonService || "").trim().toLowerCase() === name;
      }

      return false;
    }) ?? false
  );
};

const buildItemDescription = (item: FormItem) => {
  if (item.aiWarning?.trim()) {
    return `${AI_WARNING_PREFIX} ${item.aiWarning.trim()}`;
  }

  if (item.manualCurrencyConfirmed) {
    return `${MANUAL_CURRENCY_CONFIRMED_PREFIX} ${item.serviceName}`.trim();
  }

  if (item.manualUnitConfirmed) {
    return `${MANUAL_UNIT_CONFIRMED_PREFIX} ${item.unit}: ${item.serviceName}`.trim();
  }

  if (item.manualReviewConfirmed) {
    return `${MANUAL_REVIEW_CONFIRMED_PREFIX} ${item.serviceName}`.trim();
  }

  if (item.catalogReviewConfirmed) {
    return `${PRICE_REVIEW_CONFIRMED_PREFIX} ${item.serviceName}`.trim();
  }

  return item.serviceName;
};

const CUSTOMER_REVIEW_REASONS = new Set([
  "possible_customer",
  "customer_needs_review",
  "service_location_review",
  "missing_customer_data",
  "customer_conflict",
  "customer_data_incomplete",
]);

const isResolvedCustomerReviewReasonV17_90L36 = (reason?: string | null) => {
  const key = String(reason || "").trim();
  return (
    CUSTOMER_REVIEW_REASONS.has(key) ||
    key === "customer_data_uncertain_no_billing_block" ||
    key === "intake_risk:billing_customer_missing_or_uncertain"
  );
};

const hasRealCustomerReviewReason = (order: Order) => {
  return (
    order.reviewReasons?.some((reason) =>
      CUSTOMER_REVIEW_REASONS.has(reason),
    ) ?? false
  );
};

type OrderServiceReviewGroup = {
  key: string;
  title: string;
  address: string;
  count: number;
  tooltip: string;
};

type OrderMobileServiceReviewSectionV17_90L174 = {
  title: string;
  items: Array<{ title: string; details: string[] }>;
};

const parseOrderServiceReviewTooltipV17_90L174 = (
  tooltip: string,
): OrderMobileServiceReviewSectionV17_90L174[] =>
  String(tooltip || "")
    .split(SERVICE_REVIEW_TOOLTIP_SEPARATOR)
    .map((sectionText) => {
      const lines = sectionText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const title = lines.shift() || "Leistungen prüfen";
      const items: Array<{ title: string; details: string[] }> = [];
      let current: { title: string; details: string[] } | null = null;

      lines.forEach((line) => {
        if (/^(?:\*|•)\s+/.test(line)) {
          const content = line.replace(/^(?:\*|•)\s*/, "").trim();
          const [itemTitle, ...detailParts] = content.split(/\s+—\s+/);
          current = {
            title: itemTitle || "Leistung",
            details: detailParts.length ? [detailParts.join(" — ")] : [],
          };
          items.push(current);
          return;
        }
        if (current) current.details.push(line);
      });

      return { title, items };
    })
    .filter((section) => section.items.length > 0);

type ReviewBadge = {
  key: string;
  label: string;
  className: string;
  icon?: boolean;
  tooltip?: string;
  focusTarget?: "specialNotes" | "items" | "customer" | "executionAddress";
  serviceReviewGroups?: OrderServiceReviewGroup[];
};

const compactText = (value?: string | null) =>
  (value || "").replace(/\s+/g, " ").trim();


// V17.90L168: Die vorhandenen Trennlinien bleiben feste Layoutgrenzen.
// Nur ein reines Datum wird im Terminchip ausgeschrieben; jeder Zusatz zeigt nur das Kalendersymbol.
type AdaptiveAppointmentLabels = {
  full: string;
  dateOnly: string | null;
};

const buildAdaptiveAppointmentLabels = (value?: string | null): AdaptiveAppointmentLabels => {
  const full = compactText(value) || "Termin klären";
  // V17.90L234: Show the concrete calendar day even when the canonical badge
  // also contains a time, day-part or pre-arrival instruction. The full
  // appointment remains available in the tooltip; the card chip stays compact.
  const dateMatch = full.match(
    /\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\.?\b/,
  );
  if (!dateMatch) return { full, dateOnly: null };
  const day = dateMatch[1].padStart(2, "0");
  const month = dateMatch[2].padStart(2, "0");
  return {
    full,
    dateOnly: `${day}.${month}.`,
  };
};

const serializeOrderExecutionAddressForEdit = (source: {
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
}) =>
  JSON.stringify({
    siteName: compactText(source.siteName),
    siteAddress: compactText(source.siteAddress),
    sitePlz: compactText(source.sitePlz),
    siteCity: compactText(source.siteCity),
    siteNote: compactText(source.siteNote),
  });

const isSameAddressPlaceholderV17_90L135H = (value?: string | null) =>
  /^(?:an\s+derselben\s+adresse|gleiche\s+adresse|selbe\s+adresse|rechnungsadresse(?:\s+gilt)?(?:\s+auch)?|same\s+address)[.!\s]*$/i.test(
    compactText(value),
  );

const stripVisibleNoteMarkerV17_35 = (value?: string | null) =>
  compactText(value)
    .replace(
      /^\s*\[(?:HINWEIS|INFO|NOTIZ|GEFAHR|WARNUNG|WARNHINWEIS)\]\s*/i,
      "",
    )
    .trim();

const cleanVisibleTooltipTextV17_35 = (value?: string | null) =>
  String(value || "")
    .split(/\n+/g)
    .map((line) => stripVisibleNoteMarkerV17_35(line))
    .filter(Boolean)
    .join("\n");


// V17.90L169: Termin- und operative Hinweisfenster werden lesbar gegliedert.
type StructuredAppointmentTooltipV17_90L169 = {
  date: string;
  time: string;
  note: string;
  fallback: string;
};

const parseStructuredAppointmentTooltipV17_90L169 = (
  value?: string | null,
): StructuredAppointmentTooltipV17_90L169 => {
  const fallback = cleanVisibleTooltipTextV17_35(value) || "Termin klären";
  const source = fallback.replace(/\n+/g, " · ").replace(/\s+/g, " ").trim();
  const dateMatch = source.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\.?\b/);
  const date = dateMatch
    ? `${dateMatch[1].padStart(2, "0")}.${dateMatch[2].padStart(2, "0")}.${
        dateMatch[3] ? String(dateMatch[3]).padStart(2, "0") : ""
      }`
    : "";
  const sourceWithoutDate = dateMatch
    ? source.replace(dateMatch[0], " ")
    : source;
  const clockMatches = [
    ...Array.from(
      sourceWithoutDate.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g),
    ),
    ...Array.from(
      sourceWithoutDate.matchAll(
        /\b([01]?\d|2[0-3])\.([0-5]\d)\s*(?:Uhr|h)\b/gi,
      ),
    ),
  ].map((match) => `${match[1].padStart(2, "0")}:${match[2]}`);
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
    .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, " ")
    .replace(/\b([01]?\d|2[0-3])\.([0-5]\d)\s*(?:Uhr|h)\b/gi, " ")
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

const isAppointmentBadgeV17_90L169 = (badge: ReviewBadge) =>
  ["appointment", "appointments_multiple", "appointment_clarify"].includes(
    badge.key,
  );

const isOperationalDetailBadgeV17_90L169 = (badge: ReviewBadge) =>
  badge.focusTarget === "specialNotes" &&
  !["special_notes_summary", "callback_request", "appointment_clarify"].includes(
    badge.key,
  );

const renderOrderAppointmentTooltipContentV17_90L169 = (
  badge: ReviewBadge,
  tooltip: string,
) => {
  if (badge.key === "appointments_multiple") {
    return (
      <span className="block rounded-xl border border-violet-300 bg-violet-50 p-3 text-slate-950 dark:border-violet-800/70 dark:bg-violet-950/35 dark:text-slate-50">
        <span className="mb-2 flex items-center gap-2 text-sm font-extrabold">
          <CalendarDays className="h-4 w-4 text-violet-700 dark:text-violet-300" />
          Mehrere Termine
        </span>
        <span className="block space-y-1.5">
          {tooltip.split(/\n+/g).filter(Boolean).map((line, index) => (
            <span
              key={`appointment_multiple_${index}`}
              className="block rounded-lg border border-violet-200 bg-white/80 px-2.5 py-2 text-[12px] font-semibold leading-relaxed dark:border-violet-900/60 dark:bg-slate-950/40"
            >
              {line}
            </span>
          ))}
        </span>
      </span>
    );
  }

  const parts = parseStructuredAppointmentTooltipV17_90L169(tooltip);
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
};

const renderOrderOperationalTooltipContentV17_90L169 = (
  badge: ReviewBadge,
  tooltip: string,
) => {
  const isDanger = /(?:^|\s)(?:bg|text|border)-red-/.test(
    badge.className || "",
  );
  const normalizedLabel = normalizeForMatch(badge.label);
  const normalizedTooltip =
    normalizedLabel === "hund"
      ? sanitizeDogOnlyTooltipV17_90L175(tooltip)
      : tooltip;
  const lines = normalizedTooltip
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = isDanger
    ? normalizedLabel === "hund"
      ? "Vorsicht: Hund"
      : normalizedLabel && normalizedLabel !== "achtung"
        ? `Vorsicht: ${badge.label}`
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
            key={`operational_${badge.key}_${index}`}
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
};

const normalizeForMatch = (value?: string | null) =>
  compactText(value)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");

const getOrderServiceReviewReasonV17_90L134 = (
  item: any,
  services: any[],
): string => {
  const name = compactText(item?.serviceName);
  const quantity = Number(item?.quantity || 0);
  const price = Number(item?.unitPrice || 0);
  const unit = compactText(item?.unit);
  if (!name) return "Leistung prüfen";
  if (quantity <= 0) return "Menge prüfen";
  if (!unit || /(?:prüfen|pruefen|prufen)/i.test(unit)) return "Einheit prüfen";
  if (price <= 0) return "Preis prüfen";
  const catalog = (services || []).find(
    (service: any) => normalizeForMatch(service?.name) === normalizeForMatch(name),
  );
  if (!catalog) return "Nicht im Leistungskatalog";
  const catalogUnit = compactText(catalog?.unit);
  const catalogPrice = Number(catalog?.defaultPrice || 0);
  if (catalogUnit && normalizeForMatch(catalogUnit) !== normalizeForMatch(unit))
    return "Einheit abweichend";
  if (catalogPrice > 0 && Math.abs(catalogPrice - price) >= 0.01)
    return "Preis abweichend";
  return "";
};

const getOrderServiceReviewDetailV17_90L134 = (
  item: any,
  services: any[],
  currency: "CHF" | "EUR",
): string => {
  const reason = getOrderServiceReviewReasonV17_90L134(item, services);
  if (!reason) return "";
  const name = compactText(item?.serviceName) || "Neue Leistung";
  const quantity = Number(item?.quantity || 0);
  const price = Number(item?.unitPrice || 0);
  const unit = compactText(item?.unit) || "–";
  const catalog = (services || []).find(
    (service: any) => normalizeForMatch(service?.name) === normalizeForMatch(name),
  );
  const lines = [name, reason, `Aktuell: ${quantity > 0 ? quantity : "–"} ${unit} · ${price > 0 ? formatCurrency(price, currency) : "Preis fehlt"}`];
  if (catalog) {
    lines.push(`Katalog: ${compactText(catalog?.unit) || "–"} · ${formatCurrency(Number(catalog?.defaultPrice || 0), currency)}`);
  }
  return lines.join("\n");
};


const serviceLabelHasWorkIntentV17_90L27 = (value?: string | null) => {
  const key = normalizeForMatch(value);
  if (!key) return false;
  return /\b(?:reinig|putz|pulire|clean|nettoyer|limpieza|wisch|abwisch|abstaub|staub|saug|polier|desinfiz|entfern|schneid|streichen|malen|montier|reparier)\b/.test(key) ||
    /\b(?:boden|floor|sol|paviment|pavimento|waschraumboden|kuechenboden|fenster|scheiben|glas|glastuer|glastur|glastür|tische|tavoli|regale|reifenregale|rollstuehle|rollstühle|kofferwagen|gelaender|geländer)\b/.test(key);
};

const serviceLabelContextClauseV17_90L27 = (value?: string | null) => {
  const key = normalizeForMatch(value);
  if (!key) return false;
  return /\b(?:empfang|reception|werkstattleiter|kuechenchef|küchenchef|koch|cuoco|hauswart|huuswart|chef|nachbar|patientenzimmer|schluessel|schlüssel|key|code|sms|whatsapp|telefon|anruf|rueckruf|rückruf|email|mail|achtung|vorsicht|oprez|attention|hund|pas|dog|oel|öl|kabel|strom|rutschig|scivoloso|nass|mouill|nicht|kein|keine|betreten|kommen|eintreten|rezeption|hauptrezeption|buero|büro|office|bahnhofplatz|strasse|straße|weg|gasse|platz|ring|allee|route|rue|via|viale|avenue|luzern|zuerich|zürich|baden|dietikon|lugano|basel|aarau|lausanne)\b/.test(key) || /\b\d{4,5}\b/.test(key);
};

const cleanServiceLabelContextNoiseV17_90L27 = (value?: string | null) => {
  let text = compactText(value);
  if (!text) return "";

  text = text
    .replace(/^\s*\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stück|stueck|stk|pcs?|pieces?|pi[eè]ces?|pezzi|hours?|stunden?|std\.?)\b\s*/i, "")
    .replace(/^\s*\d+(?:[.,]\d+)?\s+(?=[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß])/u, "")
    .replace(/\s*,\s*\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stück|stueck|stk|pcs?|pieces?|pi[eè]ces?|pezzi|hours?|stunden?|std\.?)\b.*$/i, "")
    .replace(/\s+\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stück|stueck|stk|pcs?|pieces?|pi[eè]ces?|pezzi|hours?|stunden?|std\.?)\b.*$/i, "")
    .replace(/\s+(?:à|a|zu|je|pro|per|each|at|x|\*)\s*(?:chf|eur|fr\.?|franken|stutz)?\s*\d+(?:[.,]\d{1,2})?.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const dash = text.match(/^(.{2,90}?)[\s,]*[-–—]\s*(.{3,})$/);
  if (dash && serviceLabelContextClauseV17_90L27(dash[1]) && serviceLabelHasWorkIntentV17_90L27(dash[2])) {
    text = dash[2].trim();
  }

  const commaParts = text.split(/\s*,\s*/g).map((part) => part.trim()).filter(Boolean);
  if (commaParts.length > 1) {
    for (let i = commaParts.length - 1; i >= 1; i -= 1) {
      const right = commaParts.slice(i).join(", ");
      const left = commaParts.slice(0, i).join(", ");
      if (serviceLabelHasWorkIntentV17_90L27(right) && serviceLabelContextClauseV17_90L27(left)) {
        text = right;
        break;
      }
    }
  }

  for (let pass = 0; pass < 3; pass += 1) {
    const before = text;
    text = text
      // V17.90L233: Kontextwörter am Anfang nur bei einer sichtbaren
      // Trennstelle entfernen. Ohne Komma/Doppelpunkt/Bindestrich kann das
      // erste Wort selbst Teil der kanonischen Leistung sein, z. B.
      // „Empfang und zwei Sitzungszimmer komplett reinigen“.
      .replace(/^(?:empfang|reception|werkstattleiter|kuechenchef|küchenchef|koch|cuoco|hauswart|huuswart|chef|patientenzimmer|schluessel|schlüssel|key|code|buero|büro|office|bahnhofplatz|luzern|zuerich|zürich|baden|dietikon|lugano|basel|aarau|lausanne)\b\s*[,;:-]\s*/i, "")
      .replace(/^(?:bitte|nur|kein|keine|nicht|vorher|sms|whatsapp|telefon|anruf|rueckruf|rückruf|achtung|vorsicht|oprez|attention|hund|pas|dog|oelspur|ölspur|kabel|strom|rutschig|scivoloso|nass)\b\s*[,;:-]?\s*/i, "")
      .trim();
    if (text === before) break;
  }

  return compactText(text).replace(/^[-–—•,;:\s]+/, "");
};

const CALLBACK_CONTACT_WORD_PATTERN =
  /\b(?:anruf|anrufen|zurueckrufen|zuruckrufen|telefonieren|telefonisch|melden|kontaktieren|rueckruf|ruckruf|anruf|call|aaluete|anluete|anlaeuten|klingeln|telefonkontakt|telefon)\b/;

const CONTACT_TIME_WORD_PATTERN =
  /\b(?:sms|whatsapp|wa|mail|e-mail|email|schreiben|senden|schicken|rueckfragen|ruckfragen|nachricht|nachrichten|kontakt|kontaktieren|melden|anruf|anrufen|zurueckrufen|zuruckrufen|telefonieren|telefonisch|rueckruf|ruckruf|call|aaluete|anluete|anlaeuten|klingeln|telefonkontakt|telefon)\b/;

const CALLBACK_TIME_PATTERN =
  /(?:\b(?:erst\s+ab|erst\s+nach|nicht\s+vor|nicht\s+vorher\s+als|fruehestens|frühestens|ab|nach)\s+\d{1,2}(?:\s+\d{2}|[:.]\d{2})?\s*(?:uhr|h)?\b|\bzwischen\s+\d{1,2}(?::|\.)\d{2}\s*(?:uhr|h)?\s+(?:und|bis)\s+\d{1,2}(?::|\.)\d{2}\s*(?:uhr|h)?\b|\bvon\s+\d{1,2}(?::|\.)\d{2}\s*(?:uhr|h)?\s+bis\s+\d{1,2}(?::|\.)\d{2}\s*(?:uhr|h)?\b)/;

const SWISS_NEGATION_PATTERN = "(?:noed|nöd|ned|nid|nit|nued|nüt|nuet)";

const isPreArrivalInstructionLine = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text) return false;

  return new RegExp(
    `(?:nicht|${SWISS_NEGATION_PATTERN})\\s+einfach\\s+(?:kommen|vorbeikommen|cho|verbi\\s+cho)|` +
      `(?:nicht|${SWISS_NEGATION_PATTERN})\\s+ohne\\s+(?:ruecksprache|rucksprache|absprache)\\s+(?:kommen|vorbeikommen|cho)|` +
      `(?:nicht\\s+vor|nicht\\s+vorher\\s+als|erst\\s+ab|fruehestens|frühestens)\\s+\\d{1,2}(?:[:.]\\d{2})?\\s*(?:uhr|h)?\\s*(?:kommen|erscheinen|starten|beginnen|da\\s+sein|vor\\s+ort)|` +
      `vor\\s+\\d{1,2}(?:[:.]\\d{2})?\\s*(?:uhr|h)?\\s+(?:nicht|${SWISS_NEGATION_PATTERN})\\s+(?:kommen|erscheinen|starten|beginnen|vorbeikommen|cho)|` +
      `vor\\s+(?:start|arbeitsbeginn|ankunft)\\s+(?:kurz\\s+)?(?:telefonisch\\s+)?(?:melden|anrufen|kontaktieren)|` +
      `erst\\s+nach\\s+(?:ruecksprache|rucksprache|absprache)\\s+(?:kommen|vorbeikommen|cho)`,
  ).test(text);
};

const isNegativeWhatsAppInstructionLine = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text) return false;

  return new RegExp(
    `\\b(?:keine?|kein|ohne|nicht|${SWISS_NEGATION_PATTERN})\\s+(?:per\\s+|via\\s+)?whats\\s*app\\b|` +
      `\\bwhats\\s*app\\s+(?:bitte\\s+)?(?:nein|keine?|kein|${SWISS_NEGATION_PATTERN}|nicht(?!\\s+(?:telefon|telefonisch|anrufen|zurueckrufen|zuruckrufen)))\\b`,
  ).test(text);
};

const SOURCE_LINE_GENERIC_TOKENS = new Set([
  "arbeiten",
  "arbeit",
  "auftrag",
  "service",
  "leistung",
  "leistungen",
  "reinigen",
  "reinigung",
  "cleaning",
  "clean",
  "nettoyage",
  "pulizia",
  "limpieza",
  "machen",
  "bitte",
]);

const sourceLineServiceTokens = (serviceName?: string | null) => {
  const serviceKey = normalizeForMatch(serviceName);
  const tokens = serviceKey
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !SOURCE_LINE_GENERIC_TOKENS.has(token));

  if (/fenster|vitrin|vitre|window|fenetre|finestr|ventan/.test(serviceKey)) {
    tokens.push(
      "fenster",
      "vitrin",
      "vitre",
      "window",
      "fenetre",
      "finestr",
      "ventan",
    );
  }

  if (/boden|floor|sol|paviment|suelo/.test(serviceKey)) {
    tokens.push("boden", "floor", "sol", "paviment", "suelo");
  }

  if (
    /anfahrt|fahrt|weg|deplacement|deplacement|travel|trip|transport|trasfert|viaje/.test(
      serviceKey,
    )
  ) {
    tokens.push(
      "anfahrt",
      "fahrt",
      "deplacement",
      "travel",
      "trip",
      "transport",
      "trasfert",
      "viaje",
    );
  }

  return Array.from(new Set(tokens));
};

const normalizeSourceNumber = (value?: string | number | null) => {
  const numeric = Number(
    String(value ?? "")
      .replace("'", "")
      .replace(",", "."),
  );
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return Number.isInteger(numeric)
    ? String(numeric)
    : String(Number(numeric.toFixed(2))).replace(".", "[.,]");
};

const sourceLineContainsNumber = (
  line: string,
  value?: string | number | null,
) => {
  const numberPattern = normalizeSourceNumber(value);
  if (!numberPattern) return false;
  return new RegExp(`(^|[^0-9])${numberPattern}([^0-9]|$)`).test(line);
};

const sourceLineUnitTokens = (unit?: string | null) => {
  const key = normalizeForMatch(unit);
  if (!key) return [];
  if (key === "quadratmeter") return ["quadratmeter", "qm", "m2", "m²", "sqm"];
  if (key === "kubikmeter") return ["kubikmeter", "cbm", "m3", "m³"];
  if (key === "meter") return ["meter", "laufmeter", "lfm"];
  if (key === "stueck" || key === "stuck")
    return [
      "stueck",
      "stuck",
      "stück",
      "stk",
      "piece",
      "pieces",
      "vitrine",
      "vitrines",
    ];
  if (key === "stunde") return ["stunde", "stunden", "std", "hour", "hours"];
  if (key === "tag") return ["tag", "tage", "day", "days"];
  if (key === "pauschal") return ["pauschal", "pauschale", "flat", "forfait"];
  if (key === "kilogramm") return ["kilogramm", "kg"];
  if (key === "tonne") return ["tonne", "tonnen", "t"];
  if (key === "liter") return ["liter", "ltr", "l"];
  return [key];
};

const localPriceSegmentsForDisplayV17_90L28 = (sourceText?: string | null) => {
  const source = String(sourceText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!source) return [] as string[];

  const lines = source
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const unitWords =
    "(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stück|stueck|stuck|stk|pcs?|pieces?|pi[eè]ces?|pezzi|vitres?|fenster|scheiben|stunden?|std\.?)";
  const money = "(?:chf|eur|fr\.?|franken|stutz|€)";
  const measuredPattern = new RegExp(
    `\b\d+(?:[.,]\d+)?\s*${unitWords}\b(?:\s*(?:à|a|zu|je|pro|per|each|at|x))?\s*(?:${money}\s*)?\d+(?:[.,]\d{1,2})?(?:\s*${money})?\b`,
    "gi",
  );
  const flatPattern = new RegExp(
    `\b(?:anfahrt|fahrtkosten|fahrt|fahrpauschale|wegpauschale|reisepauschale|trasferta|deplacement|déplacement|travel|trip|transport)\b[^\n.;|]{0,80}?(?:${money}\s*\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s*${money})\b`,
    "gi",
  );

  const segments: string[] = [];
  for (const line of lines) {
    let previousEnd = 0;
    for (const match of line.matchAll(measuredPattern)) {
      const index = match.index ?? 0;
      const prefix = line.slice(previousEnd, index).trim();
      const tail = prefix.split(/\s+/g).filter(Boolean).slice(-8).join(" ");
      const segment = `${tail} ${match[0] || ""}`.replace(/\s+/g, " ").trim();
      if (segment) segments.push(segment);
      previousEnd = index + String(match[0] || "").length;
    }

    for (const match of line.matchAll(flatPattern)) {
      const segment = String(match[0] || "").replace(/\s+/g, " ").trim();
      if (segment) segments.push(segment);
    }
  }

  return Array.from(new Set(segments));
};

const trimDisplayEvidenceToServiceV17_90L28 = (
  line: string,
  serviceName?: string | null,
) => {
  const serviceTokens = sourceLineServiceTokens(serviceName).map(normalizeForMatch);
  if (serviceTokens.length === 0) return line;

  const words = line.split(/\s+/g).filter(Boolean);
  let firstPricingIndex = words.findIndex((word) =>
    /^(?:\d+(?:[.,]\d+)?|chf|eur|€|franken|stutz|à|a|zu|je|pro)$/i.test(word),
  );
  if (firstPricingIndex < 0) firstPricingIndex = words.length;

  // V17.90L29: pick the service token closest to the measured price, not the
  // first matching token in a noisy one-line WhatsApp text. This removes
  // access/hazard fragments such as "Schlüssel beim Werkstattleiter" from
  // visible evidence for "Boden reinigen".
  let bestIndex = -1;
  for (let i = 0; i < words.length; i += 1) {
    const key = normalizeForMatch(words[i]);
    if (!key) continue;
    if (serviceTokens.some((token) => token && key.includes(token))) {
      if (i <= firstPricingIndex || bestIndex < 0) bestIndex = i;
    }
  }

  if (bestIndex <= 0) return line.replace(/\s+/g, " ").trim();

  const cleaned = words.slice(bestIndex).join(" ").replace(/\s+/g, " ").trim();
  return cleaned
    .replace(/^boden,\s*/i, "")
    .replace(/^(?:schluessel|schlussel|schlüssel|key|code|empfang|rezeption|hauswart|werkstattleiter|tresen)[^,;]*[,;]\s*/i, "")
    .trim();
};

const findCustomerTextLineForService = (
  sourceText?: string | null,
  serviceName?: string | null,
  item?: {
    quantity?: string | number | null;
    unit?: string | null;
    unitPrice?: string | number | null;
  },
) => {
  const source = String(sourceText || "").trim();
  const serviceKey = normalizeForMatch(serviceName);
  if (!source || !serviceKey) return "";

  const importantTokens = sourceLineServiceTokens(serviceName);
  if (importantTokens.length === 0) return "";

  const rawLines = source
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const localSegments = localPriceSegmentsForDisplayV17_90L28(source);
  const lines = Array.from(new Set([...localSegments, ...rawLines]));

  let bestLine = "";
  let bestScore = 0;

  for (const line of lines) {
    if (/^\s*\[?\s*(?:titel|title)\s*:/i.test(line)) continue;
    const lineKey = normalizeForMatch(line);
    if (!lineKey) continue;

    const directNameMatch = lineKey.includes(serviceKey);
    const tokenHits = importantTokens.filter((token) =>
      lineKey.includes(normalizeForMatch(token)),
    ).length;

    if (!directNameMatch && tokenHits === 0) continue;

    let score = directNameMatch ? 10 : tokenHits * 4;

    if (sourceLineContainsNumber(lineKey, item?.quantity)) score += 6;
    if (sourceLineContainsNumber(lineKey, item?.unitPrice)) score += 6;

    const unitTokens = sourceLineUnitTokens(item?.unit);
    if (
      unitTokens.some((token) => lineKey.includes(normalizeForMatch(token)))
    ) {
      score += 2;
    }

    if (localSegments.includes(line)) score += 8;

    if (score > bestScore) {
      bestScore = score;
      bestLine = line;
    }
  }

  return bestScore >= 4
    ? trimDisplayEvidenceToServiceV17_90L28(bestLine, serviceName)
    : "";
};

// V17.90L81: For the yellow position review, prefer the evidence persisted on
// the item itself. Re-scanning an entire one-line WhatsApp message can attach
// all following services, access notes and appointment text to one position.
// This helper is display-only and does not alter review state, values or saving.
const getCompactStoredItemEvidenceV17_90L81 = (
  sourceDescription?: string | null,
  serviceName?: string | null,
  item?: {
    quantity?: string | number | null;
    unit?: string | null;
    unitPrice?: string | number | null;
  },
) => {
  const stored = stripInternalItemDescriptionMarkers(sourceDescription)
    .replace(new RegExp(`^\\s*${MANUAL_CURRENCY_CONFIRMED_PREFIX}\\s*`, "i"), "")
    .replace(new RegExp(`^\\s*${MANUAL_UNIT_CONFIRMED_PREFIX}\\s*[^:]*:\\s*`, "i"), "")
    .trim();
  if (!stored) return "";

  const lineLocal = findCustomerTextLineForService(stored, serviceName, item);
  const candidate = compactText(lineLocal || stored)
    .replace(/^[-•*]+\s*/, "")
    .trim();
  if (!candidate) return "";

  // A stored item description should normally already be line-local. The cap is
  // a final UI guard only; it never rewrites the persisted description.
  return candidate.length <= 220
    ? candidate
    : `${candidate.slice(0, 217).trim()}…`;
};

const cleanLineLocalServiceLabelGrammarV17_60 = (value?: string | null) =>
  compactText(
    cleanServiceLabelContextNoiseV17_90L27(value)
      .replace(/^\s*(?:text|kundentext|quelle|source|evidence)\s*[:：]\s*/i, "")
      .replace(/\s*[,;:]\s*(?=[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß]{3,}(?:en|ern|eln)\b\s*$)/giu, " ")
      .replace(/\bsauber\s+machen\s+reinigen\b/gi, "sauber machen")
      .replace(/\bsaubermachen\s+reinigen\b/gi, "saubermachen")
      .replace(/\s*[\(\[\{]+\s*$/g, "")
      .trim(),
  );

const cleanVisibleServiceAmountFragmentsV17_90L30 = (value?: string | null) =>
  compactText(value)
    .replace(/^\s*\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stück|stueck|stk|pcs?|pieces?|pi[eè]ces?|pezzi|hours?|stunden?|std\.?)\b\s*/i, "")
    .replace(/^\s*\d+(?:[.,]\d+)?\s+(?=[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß])/u, "")
    .replace(/\s*,?\s*\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stück|stueck|stk|pcs?|pieces?|pi[eè]ces?|pezzi|hours?|stunden?|std\.?)\b.*$/i, "")
    .replace(/\s+(?:à|a|zu|je|pro|per|each|at|x|\*)\s*(?:chf|eur|fr\.?|franken|stutz)?\s*\d+(?:[.,]\d{1,2})?.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

// V17.90L95: The editor must display and submit the canonical structured
// service name. It may remove visible amount fragments, but it must not perform
// a second semantic mapping. Correct names therefore remain stable through
// opening, editing and saving the order.
const canonicalServiceNameForOrderItem = (value?: string | null) =>
  cleanVisibleServiceAmountFragmentsV17_90L30(
    cleanLineLocalServiceLabelGrammarV17_60(value),
  );

const formatMergedNumberString = (value: number) => {
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(4)));
};

const mergeEquivalentFormItems = (items: FormItem[]) => {
  const merged: FormItem[] = [];
  const indexByKey = new Map<string, number>();

  items.forEach((item) => {
    const serviceName = canonicalServiceNameForOrderItem(item.serviceName);
    const normalizedItem: FormItem = { ...item, serviceName };
    const unitKey = normalizeForMatch(normalizedItem.unit);
    const unitPriceNumber = Number(normalizedItem.unitPrice || 0);
    const unitPriceKey = Number.isFinite(unitPriceNumber)
      ? String(unitPriceNumber)
      : compactText(normalizedItem.unitPrice);
    const warningKey = normalizeForMatch(normalizedItem.aiWarning);
    const confirmedKey = normalizedItem.manualCurrencyConfirmed
      ? "manual_currency_confirmed"
      : normalizedItem.catalogReviewConfirmed
        ? "catalog_review_confirmed"
        : normalizedItem.manualUnitConfirmed
          ? `manual_unit_confirmed:${normalizeForMatch(normalizedItem.unit)}`
          : "";
    const mergeKey = [
      normalizeForMatch(serviceName),
      unitKey,
      unitPriceKey,
      warningKey,
      confirmedKey,
      // V17.90L62: Same catalog label/price does not mean the same contractual
      // position. Separate source lines/work areas must stay separate in the
      // editor (e.g. Kellergänge 180 m² and Eingangsbereich 65 m²).
      normalizeForMatch(normalizedItem.sourceDescription || ""),
      normalizedItem.workSiteId || "",
    ].join("|");

    const existingIndex = indexByKey.get(mergeKey);
    const quantityNumber = Number(normalizedItem.quantity || 0);

    if (existingIndex !== undefined && Number.isFinite(quantityNumber)) {
      const existing = merged[existingIndex];
      const existingQuantity = Number(existing.quantity || 0);
      if (Number.isFinite(existingQuantity)) {
        existing.quantity = formatMergedNumberString(
          existingQuantity + quantityNumber,
        );
      }
      return;
    }

    indexByKey.set(mergeKey, merged.length);
    merged.push(normalizedItem);
  });

  return merged;
};

const mergeEquivalentOrderItems = (items: any[]) =>
  mergeEquivalentFormItems(
    items.map((item) => ({
      key: Math.random().toString(36).slice(2),
      serviceName: item.serviceName ?? item.description ?? "",
      unit: item.unit ?? item.priceType ?? "Stunde",
      unitPrice: String(item.unitPrice ?? 0),
      quantity: String(item.quantity ?? 0),
      aiWarning: getAiWarningFromItemDescription(item.description),
      catalogReviewConfirmed: getCatalogReviewConfirmedFromItemDescription(
        item.description,
      ),
      manualUnitConfirmed: getManualUnitConfirmedFromItemDescription(
        item.description,
      ),
      workSiteId: item.workSiteId || null,
      workSite: item.workSite || null,
    })),
  ).map((item) => ({
    serviceName: item.serviceName,
    description: buildItemDescription(item),
    quantity: Number(item.quantity || 0),
    unit: item.unit,
    unitPrice: Number(item.unitPrice || 0),
    workSiteId: item.workSiteId || null,
    workSite: item.workSite || null,
  }));

const hasMissingOrFallbackCustomerName = (value?: string | null) => {
  const name = compactText(value);
  return !name || isFallbackCustomerName(name);
};

const isUnconfirmedCustomerDraft = (customer?: {
  customerNumber?: string | null;
  address?: string | null;
  plz?: string | null;
  city?: string | null;
}) =>
  Boolean(
    customer &&
      !String(customer.customerNumber || "").trim() &&
      (!String(customer.address || "").trim() ||
        !String(customer.plz || "").trim() ||
        !String(customer.city || "").trim()),
  );

const pushUniqueBadge = (badges: ReviewBadge[], badge: ReviewBadge) => {
  const existing = badges.find((entry) => entry.key === badge.key);
  if (!existing) {
    badges.push(badge);
    return;
  }

  const tooltipLines = [existing.tooltip, badge.tooltip]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/\n+/g))
    .map((line) => cleanVisibleTooltipTextV17_35(line))
    .filter(Boolean);
  const seen = new Set<string>();
  existing.tooltip = tooltipLines
    .filter((line) => {
      const key = normalizeForMatch(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n");
};

const hasOrderImage = (order: Order) => {
  return (
    (order.imageUrls?.length ?? 0) > 0 ||
    (Boolean(order.mediaUrl) && order.mediaType === "image")
  );
};

// CARD_BADGE_SEMANTIC_SPECIAL_NOTES_V14
// Card chips are now based on cleaned semantic specialNotes only.
// We no longer scan raw notes/audio/description/service text for chips, because
// phrases like "kein Hund" or "kein Termin" created false positives.
const isServiceLikeOperationalHintForBadges = (value?: string | null) => {
  const raw = compactText(value);
  const text = normalizeForMatch(value);
  if (!raw || !text) return false;

  const hasWorkAction =
    /(?:\b|[a-z])(?:reinigen|reinigung|gereinigt|putzen|saeubern|säubern|clean(?:ing)?|nettoyage|nettoyer|pulizia|limpieza)\b/.test(
      text,
    );
  const hasMeasureOrPrice =
    /\b\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|stunden?|std|stueck|stück|stk|pcs?|chf|eur|euro|franken|stutz)\b/i.test(
      raw,
    ) ||
    /\(\s*\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|stueck|stück|stk)\s*\)/i.test(
      raw,
    ) ||
    /\b(?:chf|eur|euro|franken|stutz)\s*\d/i.test(raw);

  const actionCount = (
    text.match(
      /(?:\b|[a-z])(?:reinigen|reinigung|gereinigt|putzen|saeubern|säubern|clean(?:ing)?|nettoyage|nettoyer|pulizia|limpieza)\b/g,
    ) || []
  ).length;
  const hasListSeparator = /[,;+]/.test(raw);
  const hasOperationalSignal =
    /\b(?:schluessel|schlussel|schlüssel|key|code|torcode|zugangscode|hund|dog|chien|leiter|sms|whatsapp|telefon|anrufen|nicht\s+einfach|vorher|termin)\b/.test(
      text,
    );

  const hasServiceListSummary =
    hasListSeparator &&
    actionCount >= 1 &&
    /\b(?:anfahrt|fahrtkosten|fahrt|pauschale)\b/.test(text);

  return (
    hasWorkAction &&
    !hasOperationalSignal &&
    (hasMeasureOrPrice ||
      (hasListSeparator && actionCount >= 2) ||
      hasServiceListSummary)
  );
};

const isNegatedDogHint = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (
    !text ||
    !/\b(?:hund|hunde|dog|dogs|chien|chiens|cane|cani|perro|perros|cao|caes)\b/.test(
      text,
    )
  )
    return false;

  // Nur echte Abwesenheit unterdrückt den Hund-Chip. Hinweise wie
  // "Hund ist nicht gefährlich" bedeuten weiterhin: Hund vorhanden -> roter Hund-Chip.
  return (
    /\b(?:kein|keine|keinen|keinem|keiner|ohne|no|without|pas|sans|aucun|aucune|nessun|nessuna|sin)\b.{0,36}\b(?:hund|hunde|dog|dogs|chien|chiens|cane|cani|perro|perros|cao|caes)\b/.test(
      text,
    ) ||
    /\b(?:hund|hunde|dog|dogs|chien|chiens|cane|cani|perro|perros|cao|caes)\b.{0,36}\b(?:none|absent|abwesend|nicht\s+(?:vorhanden|da|anwesend)|kein\s+thema|no\s+issue)\b/.test(
      text,
    )
  );
};

const normalizeOperationalHintDisplay = (
  kind: string,
  value?: string | null,
) => {
  const raw = compactText(value);
  const text = normalizeForMatch(value);
  if (!raw || !text) return "";

  if (kind === "care") {
    if (/holzspielzeug|holz|nicht nass|nicht feucht|trocken|dry/.test(text)) {
      return "Schonend reinigen, nicht nass reinigen";
    }
    if (
      /pavimento delicat|detergente neutro|detergent neutre|delicate floor|sensitive floor|empfindlich|delikat|heikel|schonend|neutral/.test(
        text,
      )
    ) {
      return "Empfindlicher Boden, neutrales Reinigungsmittel verwenden";
    }
  }

  // V17.90L114: Keep access/door chips visibly German even when the stored
  // source note is French, English, Spanish or Italian. This changes display
  // wording only; the stored note and intake data remain untouched.
  if (kind === "access") {
    return raw
      .replace(/\bbadge\s+d[’']?acc[eè]s\b/gi, "Zugangsausweis")
      .replace(/\baccess\s+badge\b/gi, "Zugangsausweis")
      .replace(/\bbadge\s+de\s+acceso\b/gi, "Zugangsausweis")
      .replace(/\bbadge\s+di\s+accesso\b/gi, "Zugangsausweis");
  }

  return raw;
};

const getSemanticBadgeKind = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text) return null;

  if (isServiceLikeOperationalHintForBadges(value)) return null;
  if (isNegatedDogHint(value)) return null;

  if (
    /oel|öl|rutsch|strom|kabel|gas|rauch|scherb|asbest|schimmel|chem|feuer|brand|sturz|absturz/.test(
      text,
    )
  ) {
    return "warning";
  }

  if (/hund/.test(text)) return "dog";
  if (
    /empfindlich|delikat|heikel|schonend|neutral(?:e[rsn]?)?\s+(?:reinigungsmittel|reiniger)|detergent\s+neutre|detergente\s+neutro|sensitive\s+floor|delicate\s+floor|pavimento\s+delicato|pavimento\s+delicata/.test(
      text,
    )
  )
    return "care";
  if (
    /baustellenhelm|bauhelm|helm|sicherheitsschuhe?|schutzschuhe?|schutzkleidung|schutzhelm|psa|ppe|ueberschuhe|überschuhe/.test(
      text,
    )
  )
    return "ppe";
  // Leiter nur als Werkzeug anzeigen, nicht bei Rollenwörtern wie Bauleiter.
  // Darum nicht mehr auf jedes "leiter" reagieren, sondern nur bei echtem
  // Ausrüstungs-/Mitbring-Signal.
  if (
    /\b(?:kleine|grosse|große|hohe|eigene|tritt|steh|auszieh)?\s*leiter\b/.test(
      text,
    ) &&
    /\b(?:benoetigt|benötigt|braucht|mitbringen|bringen|nehmen|erforderlich|noetig|nötig|vorhanden|steht|stehen|liegt|befindet|halle|lager|raum|empfang|rezeption|aufstellen|kleine|grosse|große|tritt|steh|auszieh)\b/.test(
      text,
    )
  )
    return "ladder";
  if (/park|parking|parkplatz|parken|parkieren/.test(text)) return "parking";
  if (/schluessel|schlussel|schlüssel/.test(text)) return "key";
  if (
    /zugang|torcode|zugangscode|schluesselbox|schlusselbox|schlüsselbox|briefkasten|klingeln|lift|badge|besucherausweis/.test(
      text,
    )
  )
    return "access";
  if (isPreArrivalInstructionLine(value) || isAppointmentContactTimeLine(value))
    return null;
  if (/termin|datum|uhr|morgen|vormittag|nachmittag/.test(text))
    return "appointment";
  if (/schubkarre/.test(text)) return "wheelbarrow";
  if (/absperrband/.test(text)) return "barrier_tape";
  if (/geruest|gerüst/.test(text)) return "scaffold";
  if (/hanglage|hang|steigung/.test(text)) return "slope";

  return null;
};

const isAddressOrWorkSiteDescriptionOnlyHint = (value?: string | null) => {
  const raw = compactText(value);
  const text = normalizeForMatch(value);
  if (!raw || !text) return false;

  const hasAddressEvidence =
    /\b\d{4,5}\b/.test(raw) ||
    /\b(?:strasse|straße|str\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|rue|avenue|av\.?|chemin|via|viale|street|road|lane)\s+\d+[a-z]?\b/i.test(
      raw,
    );

  const looksLikeWorkSiteDescription =
    /\b(?:arbeiten|arbeit|ausfuehrung|ausführung|arbeitsort|einsatzort|objekt|gereinigt\s+wird|ort\s+ist)\b/.test(
      text,
    ) ||
    /\b(?:mfh|haus|keller|eingang|praxis|restaurant|halle|tiefgarage|garage)\b/.test(
      text,
    );

  const hasRealAccessAction =
    /\b(?:schluessel|schlussel|schlüssel|code|torcode|zugangscode|schluesselbox|schlusselbox|schlüsselbox|hintereingang|seiteneingang|nebeneingang|rampe|klingeln|melden|anrufen|whatsapp|sms|nicht\s+einfach|vorher|erst\s+melden|briefkasten|empfang)\b/.test(
      text,
    );

  return (
    hasAddressEvidence && looksLikeWorkSiteDescription && !hasRealAccessAction
  );
};

const isNonActionableSemanticHint = (
  value?: string | null,
  context?: string | null,
) => {
  const text = normalizeForMatch(value);
  const contextText = normalizeForMatch(context);
  if (!text) return true;

  // Pure execution-address/site descriptions are already shown as the blue site chip.
  // They must not create a second access/door chip with the same address text.
  if (isAddressOrWorkSiteDescriptionOnlyHint(value)) return true;

  // Negative access/parking information is actionable: no parking / no lift
  // must still create an orange chip. Other negated hints stay inside only.
  if (
    /kein parkplatz|keine parkplaetze|keine parkplätze|kein parken|parkverbot|kein lift|ohne lift/.test(
      text,
    )
  ) {
    return false;
  }

  const hasRealAccessConstraint =
    /schmal|enger?\s+zugang|schwieriger\s+zugang|kein lift|ohne lift|access difficult|difficult access|acces difficile/.test(
      text,
    );
  const hasActionableKeyOrBadge =
    /\b(?:schluessel|schlussel|schlüssel|key|badge|besucherausweis|schluesselbox|schlusselbox|schlüsselbox|torcode|zugangscode)\b/.test(
      text,
    );
  if (hasActionableKeyOrBadge) return false;

  const isOnlyNormalDoorInstruction =
    /klingeln|warten|haustuer|haustür|haupteingang|eingangstuer|eingangstür|kunde ist vor ort|kundin ist vor ort|oeffnet die tuer|öffnet die tür|sonner|attendre|ouvre la porte|main entrance|ring the bell|doorbell/.test(
      text,
    ) && !hasRealAccessConstraint;

  return (
    /kein|keine|keinen|nicht benoetigt|nicht benötigt|muss nicht|kein thema|ohne/.test(
      text,
    ) ||
    /termin flexibel|kein fester termin|kein terminwunsch|irgendwann/.test(
      text,
    ) ||
    /leiter eventuell|eventuell leiter|vielleicht leiter|leiter vielleicht/.test(
      text,
    ) ||
    /zugang.*(frei|offen|unproblematisch)|tuer.*offen|tür.*offen|kunde ist vor ort|kundin ist vor ort/.test(
      text,
    ) ||
    isOnlyNormalDoorInstruction ||
    /parkplatz.*(kein thema|nicht wichtig)|direkt halten|genug platz/.test(
      text,
    ) ||
    (/parkplatz.*(vorhanden|reserviert|frei|innenhof|vor ort)|parkplatz/.test(
      text,
    ) &&
      /parkplatz.*kein thema|direkt halten|genug platz|parkplatz.*nicht wichtig/.test(
        contextText,
      ))
  );
};

const isPositiveSemanticHint = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text) return false;

  return /park(?:platz|ieren|en)?.*(reserviert|innenhof|vorhanden|frei|erlaubt|moeglich|möglich)|besucherparkplatz|parkplatz im innenhof|parkplatz vor ort|parken moeglich|parken möglich|parking available|parking allowed|(?:lieferwagen|fahrzeug|auto)?.*(?:auf|neben|bei)\s+(?:besucherparkplatz|besucherplatz|parkplatz|platz|rampe)\s*(?:nr\.?|nummer)?\s*\d+/.test(
    text,
  );
};

const PARKING_NO_PATTERN =
  /kein parkplatz|keine parkplaetze|keine parkplätze|kein parken|parkverbot|kein stellplatz|keine stellplaetze|keine stellplätze|no parking|sans parking|sin parking/;

const PARKING_DIFFICULT_PATTERN =
  /parkplatz schwierig|parken schwierig|parkieren schwierig|nur kurz(?:zeitig)? halten|kurzhalten|an der strasse|an der straße|strasse abgestellt|straße abgestellt|fahrzeug muss .*strasse|fahrzeug muss .*straße|ausladen.*strasse|ausladen.*straße/;

const hasParkingReference = (value?: string | null) =>
  /park|parking|parkplatz|parken|parkieren/.test(normalizeForMatch(value));

const getParkingSignal = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text || !hasParkingReference(text)) {
    return {
      hasParking: false,
      hasPositive: false,
      hasNoParking: false,
      hasDifficult: false,
    };
  }

  return {
    hasParking: true,
    hasPositive: isPositiveSemanticHint(text),
    hasNoParking: PARKING_NO_PATTERN.test(text),
    hasDifficult: PARKING_DIFFICULT_PATTERN.test(text),
  };
};

const isMergedOrderForCard = (order: Order) =>
  Boolean(
    order.reviewReasons?.includes("manual_order_merge") ||
    order.reviewReasons?.includes("double_merge") ||
    (Array.isArray(order.originOrderIds) && order.originOrderIds.length > 1),
  );

const formatWorkSiteLabelForHint = (site: {
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
}) => {
  const title =
    cleanWorkSiteDisplayName(site.siteName) || compactText(site.siteAddress);
  const address = [
    compactText(site.siteAddress),
    [site.sitePlz, site.siteCity].map(compactText).filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  return [title, address].filter(Boolean).join(" · ");
};

const looksLikeWorkSitePrefix = (value?: string | null) => {
  const text = compactText(value);
  if (!text) return false;
  if (/\b\d{4,5}\b/.test(text)) return true;
  if (
    /\b(?:haus|gebäude|gebaeude|restaurant|küche|kueche|entrée|entree|technopark|limmatweg|chemin|strasse|straße|weg|gasse|platz|adresse|arbeitsort)\b/i.test(
      text,
    )
  )
    return true;
  return /\s·\s/.test(text);
};

const splitLocationPrefixedHint = (value?: string | null) => {
  let text = compactText(value)
    .replace(/^\[HINWEIS\]\s*/i, "")
    .replace(/^[-•]\s*/, "");
  let location = "";

  for (let pass = 0; pass < 4; pass += 1) {
    const match = text.match(/^([^:]{2,190}):\s+(.+)$/);
    if (!match || !looksLikeWorkSitePrefix(match[1])) break;
    location = compactText(match[1]);
    text = compactText(match[2]).replace(/^[-•]\s*/, "");
  }

  return { location, hint: text };
};

const stripRepeatedLocationPrefix = (hint: string, location: string) => {
  let text = compactText(hint).replace(/^[-•]\s*/, "");
  const normalizedLocation = normalizeForMatch(location);

  for (let pass = 0; pass < 4; pass += 1) {
    const parsed = splitLocationPrefixedHint(text);
    if (!parsed.location) break;
    if (normalizeForMatch(parsed.location) !== normalizedLocation) break;
    text = parsed.hint;
  }

  return text;
};

const SPECIAL_NOTES_GROUP_SEPARATOR = "────────────────────";

const isSpecialNotesGroupSeparator = (value?: string | null) =>
  /^[-─—–_]{6,}$/.test(compactText(value));

const isSpecialNotesGroupHeader = (value?: string | null) => {
  const text = compactText(value);
  if (!/^[^:]{2,190}:$/.test(text)) return false;
  return looksLikeWorkSitePrefix(text.replace(/:$/, ""));
};

const formatSpecialNotesForDisplay = (lines: string[]) => {
  const result: string[] = [];
  let hasCurrentGroupContent = false;

  for (const rawLine of lines) {
    const line = compactText(rawLine);
    if (!line || isSpecialNotesGroupSeparator(line)) continue;

    if (isSpecialNotesGroupHeader(line)) {
      if (result.length > 0 && hasCurrentGroupContent) {
        result.push(SPECIAL_NOTES_GROUP_SEPARATOR);
      }
      result.push(line);
      hasCurrentGroupContent = false;
      continue;
    }

    result.push(line);
    hasCurrentGroupContent = true;
  }

  return result.join("\n");
};

const structuredSpecialNoteHints = (order: Order) => {
  const lines = String(order.specialNotes || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(
      /\s*(?=\[(?:GEFAHR|WARNUNG|WARNHINWEIS|HINWEIS|INFO|NOTIZ)\]\s*)/gi,
      "\n",
    )
    .split(/\n+/g)
    .map((line) => stripVisibleNoteMarkerV17_35(line))
    .filter(Boolean);

  const fallbackSites = (order.workSites ?? [])
    .slice()
    .sort(
      (a, b) =>
        Number(b.isPrimary ? 1 : 0) - Number(a.isPrimary ? 1 : 0) ||
        Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0),
    )
    .map(formatWorkSiteLabelForHint)
    .filter(Boolean);
  const singleFallbackSite = fallbackSites.length === 1 ? fallbackSites[0] : "";

  const result: Array<{ location: string; hint: string }> = [];
  let currentLocation = "";

  for (const rawLine of lines) {
    const line = rawLine.replace(/^[-•]\s*/, "");
    const parsed = splitLocationPrefixedHint(line);

    if (parsed.location) {
      currentLocation = parsed.location;
      if (parsed.hint) {
        result.push({
          location: currentLocation,
          hint: stripRepeatedLocationPrefix(parsed.hint, currentLocation),
        });
      }
      continue;
    }

    if (
      /^\s*(?:Arbeitsort|Ausführungsort|Ausfuehrungsort|Einsatzort|Objekt)\s*:?\s*$/i.test(
        line,
      )
    ) {
      currentLocation = "";
      continue;
    }

    if (
      /^[^:]{2,190}:$/.test(line) &&
      looksLikeWorkSitePrefix(line.replace(/:$/, ""))
    ) {
      currentLocation = compactText(line.replace(/:$/, ""));
      continue;
    }

    result.push({
      location: currentLocation || singleFallbackSite,
      hint: line,
    });
  }

  return result;
};

const operationalHintMatchesKind = (
  kind: string,
  line: string,
  contextText: string,
) => {
  if (kind === "parking") {
    return (
      Boolean(getParkingBadge(line, contextText)) ||
      getParkingSignal(line).hasParking
    );
  }
  return getSemanticBadgeKind(line) === kind;
};

const formatOperationalHintTooltip = (
  order: Order,
  kind: string,
  parsedNotes: ReturnType<typeof splitSpecialNotes>,
  fallbackLine: string,
  contextText: string,
) => {
  const entries = [
    ...structuredSpecialNoteHints(order),
    ...parsedNotes.jobHints.map((line) => splitLocationPrefixedHint(line)),
  ]
    .map((entry) => {
      const cleanHint = compactText(
        stripVisibleNoteMarkerV17_35(
          stripRepeatedLocationPrefix(entry.hint, entry.location),
        ),
      );
      return {
        location: compactText(stripVisibleNoteMarkerV17_35(entry.location)),
        hint: normalizeOperationalHintDisplay(kind, cleanHint),
        matchHint: cleanHint,
      };
    })
    .filter(
      (entry) =>
        entry.matchHint &&
        operationalHintMatchesKind(kind, entry.matchHint, contextText),
    );

  const seen = new Set<string>();
  const seenHint = new Set<string>();
  const formatted: string[] = [];

  for (const entry of entries) {
    const hintKey = normalizeForMatch(entry.hint);
    const key = `${normalizeForMatch(entry.location)}|${hintKey}`;
    if (seen.has(key) || seenHint.has(hintKey)) continue;
    seen.add(key);
    seenHint.add(hintKey);

    const showLocation = kind !== "key" && kind !== "access";
    formatted.push(
      showLocation && entry.location
        ? `${entry.location}:\n${entry.hint}`
        : entry.hint,
    );
  }

  if (kind === "parking") {
    const compactParking = entries
      .map((entry) => compactText(entry.hint).replace(/[.;:,\s]+$/g, ""))
      .find(Boolean);
    if (compactParking) return compactParking;
  }

  if (formatted.length > 0) return formatted.join("\n\n");
  return compactText(fallbackLine).replace(/[.;:,\s]+$/g, "");
};

type UnifiedParkingInfoV17_90L101 = {
  status: "Parkplatz verfügbar" | "Parkplatz nicht verfügbar" | "Parkplatz nicht angegeben";
  details: string[];
};

const collectUnifiedParkingInfoV17_90L101 = (
  values: Array<string | null | undefined>,
): UnifiedParkingInfoV17_90L101 => {
  const raw = values
    .map((value) => String(value || ""))
    .filter(Boolean)
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const normalized = normalizeForMatch(raw);
  const details: string[] = [];
  const seen = new Set<string>();
  const push = (value?: string | null) => {
    const clean = compactText(value || "").replace(/[.;:,\s]+$/g, "");
    const key = normalizeForMatch(clean);
    if (!clean || !key || seen.has(key)) return;
    seen.add(key);
    details.push(clean);
  };

  const addLocationMatches = (
    pattern: RegExp,
    label: (match: RegExpExecArray) => string,
  ) => {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(raw))) push(label(match));
  };

  addLocationMatches(
    /(?:besucher(?:parkplatz|feld)|visitor\s+parking(?:\s+space)?|parking\s+visiteurs?)\s*(?:nummer|nr\.?|no\.?)?\s*[:#-]?\s*([A-Z]?\d+[A-Z]?)/giu,
    (match) =>
      /feld/i.test(match[0])
        ? `Besucherfeld ${String(match[1]).toUpperCase()}`
        : `Besucherparkplatz ${String(match[1]).toUpperCase()}`,
  );
  addLocationMatches(
    /(?:parkplatz|parking)\s+besucher(?:feld)?\s*(?:nummer|nr\.?|no\.?)?\s*[:#-]?\s*([A-Z]?\d+[A-Z]?)/giu,
    (match) => `Besucherparkplatz ${String(match[1]).toUpperCase()}`,
  );
  addLocationMatches(
    /(?:tiefgaragen(?:platz|parkplatz)|underground\s+parking(?:\s+space)?|parking\s+souterrain)\s*(?:nummer|nr\.?|no\.?)?\s*[:#-]?\s*([A-Z]?\d+[A-Z]?)/giu,
    (match) => `Tiefgaragenplatz ${String(match[1]).toUpperCase()}`,
  );
  addLocationMatches(
    /(?:parkplatz|parking\s+space|stellplatz)\s*(?:nummer|nr\.?|no\.?)?\s*[:#-]?\s*([A-Z]\d+[A-Z]?|\d+)/giu,
    (match) => `Parkplatz ${String(match[1]).toUpperCase()}`,
  );

  const durationPattern =
    /(?:maximal|max\.?|höchstens|hoechstens|maximum|up\s+to)\s*(\d+(?:[.,]\d+)?)\s*(minuten?|minutes?|stunden?|hours?|std\.?|h)\b/giu;
  let durationMatch: RegExpExecArray | null;
  while ((durationMatch = durationPattern.exec(raw))) {
    const amount = String(durationMatch[1]).replace(",", ".");
    const unitKey = normalizeForMatch(durationMatch[2]);
    const amountNumber = Number(amount);
    const unit = /(?:stund|hour|std|^h$)/.test(unitKey)
      ? amountNumber === 1
        ? "Stunde"
        : "Stunden"
      : amountNumber === 1
        ? "Minute"
        : "Minuten";
    push(`Maximale Parkdauer: ${amount} ${unit}`);
  }

  const hasNoParking =
    /\b(?:kein(?:e[nr]?)?\s+(?:parkplatz|parkmoeglichkeit|parkmöglichkeit|stellplatz)|parkverbot|parken\s+verboten|no\s+parking|without\s+parking|sans\s+parking|sin\s+parking)\b/.test(
      normalized,
    );
  const hasDifficultParking =
    /\b(?:(?:parkplatz|parken|parking)\s+(?:schwierig|problematisch|nicht\s+moeglich|nicht\s+möglich)|difficult\s+parking)\b/.test(
      normalized,
    );
  const hasPositiveParking =
    details.some((line) => !/^Maximale Parkdauer:/i.test(line)) ||
    (/\b(?:parkplatz|parking|stellplatz|tiefgarage)\b/.test(normalized) &&
      /\b(?:benutzen|verwenden|nutzen|verfuegbar|verfügbar|vorhanden|parken|use|available)\b/.test(
        normalized,
      ));

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
    status:
      hasPositiveParking && !hasNoParking && !hasDifficultParking
        ? "Parkplatz verfügbar"
        : (hasNoParking || hasDifficultParking) && !hasPositiveParking
          ? "Parkplatz nicht verfügbar"
          : "Parkplatz nicht angegeben",
    details: dedupedDetails,
  };
};

const collectParkingDetailLinesV17_90L99 = (
  values: Array<string | null | undefined>,
): string[] => collectUnifiedParkingInfoV17_90L101(values).details;

const getUnifiedParkingBadgeV17_90L99 = (
  values: Array<string | null | undefined>,
): { label: string; className: string; tooltip: string } | null => {
  const parkingValues = values
    .flatMap((value) => String(value || "").split(/\n+/g))
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^(?:parkplatz|parken|parking)\s+(?:nicht\s+angegeben|keine\s+angabe|unbekannt|offen)[.!]?$/i.test(
          normalizeForMatch(line),
        ),
    );
  const source = parkingValues.join("\n");
  const hasParkingMention =
    /\b(?:[a-z0-9-]*parkplatz|park(?:en|ieren)?|parking|stellplatz|tiefgarage|besucherfeld)\b/i.test(
      normalizeForMatch(source),
    );
  if (!hasParkingMention) return null;

  const parking = collectUnifiedParkingInfoV17_90L101(parkingValues);
  const detailText =
    parking.details.length > 0 ? `\n\n${parking.details.join("\n")}` : "";
  return {
    label: "Parken",
    className: "bg-blue-50 text-blue-700 border border-blue-300",
    tooltip: `${parking.status}${detailText}`,
  };
};

// Kept as a narrow compatibility helper for existing tooltip matching.
const getParkingBadge = (
  value?: string | null,
  _context?: string | null,
): { label: string; className: string } | null => {
  if (!getParkingSignal(value).hasParking) return null;
  return {
    label: "Parken",
    className: "bg-blue-50 text-blue-700 border border-blue-300",
  };
};

const badgeLabelByKind: Record<string, string> = {
  warning: "Achtung",
  dog: "Hund",
  ladder: "Leiter",
  parking: "Parken",
  key: "Schlüssel",
  access: "Zugang",
  appointment: "Termin",
  wheelbarrow: "Schubkarre",
  barrier_tape: "Absperrband",
  scaffold: "Gerüst",
  slope: "Hanglage",
  care: "Schonend",
  ppe: "Schutz",
};

const dangerBadgeLabel = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (/hund/.test(text) && !isNegatedDogHint(value)) return "Hund";
  if (/oel|öl/.test(text)) return "Öl";
  if (/rutsch/.test(text)) return "Rutschig";
  if (/strom|kabel/.test(text)) return "Strom";
  if (/gas|rauch/.test(text)) return "Gas/Rauch";
  if (/scherb/.test(text)) return "Scherben";
  if (/asbest/.test(text)) return "Asbest";
  if (/schimmel/.test(text)) return "Schimmel";
  if (/chem/.test(text)) return "Chemie";
  if (/feuer|brand/.test(text)) return "Feuer";
  if (/sturz|absturz/.test(text)) return "Sturz";
  return "Achtung";
};

const badgeSortRank = (badge: ReviewBadge) => {
  if (badge.key === "special_notes_summary") return -1;
  if (badge.key === "hint_parking") return -0.5;
  const className = badge.className || "";
  if (/bg-red-|text-red-|border-red-/.test(className)) return 0;
  if (
    /bg-orange-|text-orange-|border-orange-|bg-amber-|text-amber-|border-amber-|bg-yellow-|text-yellow-|border-yellow-/.test(
      className,
    )
  )
    return 1;
  if (
    /bg-emerald-|text-emerald-|border-emerald-|bg-green-|text-green-|border-green-/.test(
      className,
    )
  )
    return 2;
  return 3;
};

const sortReviewBadges = (badges: ReviewBadge[]) =>
  badges
    .map((badge, index) => ({ badge, index }))
    .sort(
      (a, b) =>
        badgeSortRank(a.badge) - badgeSortRank(b.badge) || a.index - b.index,
    )
    .map((entry) => entry.badge);

const formatAppointmentTime = (hour: string, minute?: string) => {
  const normalizedHour = hour.padStart(2, "0");
  return `${normalizedHour}:${minute || "00"}`;
};

const parseAppointmentBaseDate = (value?: string | null) => {
  const parsed = value ? new Date(value) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  date.setHours(12, 0, 0, 0);
  return date;
};

const parseAppointmentReferenceDate = (value?: string | null) => {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const formatAppointmentDate = (date: Date) =>
  `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.`;

const resolveWeekdayAppointmentDate = (
  weekdayIndex: number,
  baseDateInput?: string | null,
  forceNextWeek = false,
) => {
  const baseDate = parseAppointmentBaseDate(baseDateInput);
  const currentWeekday = baseDate.getDay() === 0 ? 7 : baseDate.getDay();

  if (forceNextWeek) {
    const daysUntilNextMonday = 8 - currentWeekday;
    return addDays(baseDate, daysUntilNextMonday + weekdayIndex - 1);
  }

  let daysUntilTarget = weekdayIndex - currentWeekday;
  if (daysUntilTarget < 0) daysUntilTarget += 7;
  return addDays(baseDate, daysUntilTarget);
};

const buildAppointmentMoment = (
  date: Date,
  time?: string,
  dayPart?: string,
) => {
  const appointmentMoment = new Date(date);

  if (time) {
    const [hour, minute] = time.split(":").map((part) => Number(part));
    appointmentMoment.setHours(hour || 0, minute || 0, 0, 0);
  } else if (dayPart === "Vorm.") {
    appointmentMoment.setHours(12, 0, 0, 0);
  } else if (dayPart === "Nachm.") {
    appointmentMoment.setHours(18, 0, 0, 0);
  } else if (dayPart === "Abend") {
    appointmentMoment.setHours(23, 59, 0, 0);
  } else {
    appointmentMoment.setHours(23, 59, 0, 0);
  }

  return appointmentMoment;
};

const isAmbiguousElapsedSameDayAppointment = (
  date: Date,
  baseDateInput?: string | null,
  time?: string,
  dayPart?: string,
) => {
  const reference = parseAppointmentReferenceDate(baseDateInput);
  const appointmentMoment = buildAppointmentMoment(date, time, dayPart);

  const sameCalendarDay =
    appointmentMoment.getFullYear() === reference.getFullYear() &&
    appointmentMoment.getMonth() === reference.getMonth() &&
    appointmentMoment.getDate() === reference.getDate();

  return sameCalendarDay && appointmentMoment.getTime() <= reference.getTime();
};

const isNonActionableAppointmentHint = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text) return true;

  return (
    /termin\s*(?:ist\s*)?flexibel/.test(text) ||
    /flexibler\s+termin/.test(text) ||
    /kein\s+fester\s+termin/.test(text) ||
    /kein\s+terminwunsch/.test(text) ||
    /terminwunsch\s*(?:offen|flexibel)/.test(text) ||
    /\birgendwann\b/.test(text) ||
    /nach\s+absprache/.test(text) ||
    /wenn\s+es\s+passt/.test(text) ||
    /no\s+fixed\s+appointment/.test(text) ||
    /flexible\s+appointment/.test(text)
  );
};

const splitAppointmentSources = (
  ...values: Array<string | null | undefined>
) => {
  const sources: string[] = [];

  values.forEach((value) => {
    const raw = String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();
    if (!raw) return;

    raw
      .split(/\n+/g)
      .map((line) => compactText(line))
      .filter(Boolean)
      .forEach((line) => sources.push(line));

    // Keep the full text as a fallback so "Termin 22.05. 16:00" is not
    // split after the date dot and the real time stays visible on the chip.
    const compactRaw = compactText(raw);
    if (compactRaw) sources.push(compactRaw);

    // V17.90L84: In chaotischen Einzeilern kann der echte Termin mitten in
    // Kontakt-/Zugangstext stehen. Den expliziten Terminabschnitt zusätzlich
    // isolieren, damit ein anderer Kontaktzeit-Hinweis nicht die ganze Zeile
    // als Rückrufzeit ausfiltert.
    extractEmbeddedAppointmentLinesV17_90L80(raw).forEach((line) =>
      sources.push(line),
    );
  });

  return Array.from(new Set(sources));
};

const isSameAppointmentCalendarDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const getAppointmentBadgeVisual = (
  appointmentMoment: Date | null,
  labelParts: string[],
  orderStatus?: string | null,
) => {
  const normalClass = "bg-violet-100 text-violet-700 border border-violet-300";
  const tomorrowClass =
    "bg-violet-200 text-violet-800 border border-violet-400";
  const todayClass = "bg-orange-100 text-orange-800 border border-orange-300";
  const overdueClass = "bg-slate-100 text-slate-600 border border-slate-300";
  const doneClass = "bg-slate-100 text-slate-600 border border-slate-300";

  const cleanLabel = labelParts.filter(Boolean).join(" ").trim();
  const completed = normalizeForMatch(orderStatus).includes("erledigt");

  if (!appointmentMoment || Number.isNaN(appointmentMoment.getTime())) {
    return {
      label: cleanLabel ? `Termin ${cleanLabel}` : "Termin",
      className: normalClass,
    };
  }

  if (completed) {
    return {
      label: cleanLabel ? `Termin ${cleanLabel}` : "Termin",
      className: doneClass,
    };
  }

  const now = new Date();
  const tomorrow = addDays(now, 1);

  if (appointmentMoment.getTime() < now.getTime()) {
    return {
      label: cleanLabel ? `Überfällig ${cleanLabel}` : "Überfällig",
      className: overdueClass,
      icon: true,
    };
  }

  if (isSameAppointmentCalendarDay(appointmentMoment, now)) {
    const timeLabel = labelParts.slice(1).filter(Boolean).join(" ").trim();
    return {
      label: timeLabel ? `Heute ${timeLabel}` : "Heute",
      className: todayClass,
    };
  }

  if (isSameAppointmentCalendarDay(appointmentMoment, tomorrow)) {
    const timeLabel = labelParts.slice(1).filter(Boolean).join(" ").trim();
    return {
      label: timeLabel ? `Morgen ${timeLabel}` : "Morgen",
      className: tomorrowClass,
    };
  }

  return {
    label: cleanLabel ? `Termin ${cleanLabel}` : "Termin",
    className: normalClass,
  };
};

const extractAppointmentBadge = (
  value?: string | null,
  baseDateInput?: string | null,
  orderStatus?: string | null,
) => {
  const raw = compactText(value);
  const text = normalizeForMatch(raw);
  if (!hasExplicitAppointmentBadgeSignalV17_90L10(raw)) return null;
  const hasConcreteAppointmentSignal = Boolean(
    hasAppointmentIntentWord(raw) &&
      (raw.match(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/) ||
        raw.match(/\b(?:heute|morgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i)) &&
      raw.match(/\b(?:[01]?\d|2[0-3])(?::|\.)\d{2}\b/),
  );
  if (
    !text ||
    isCallbackTimeLine(raw) ||
    isResourceAvailabilityTimeLineV17_90L84(raw) ||
    (isPreArrivalInstructionLine(raw) && !hasConcreteAppointmentSignal) ||
    isNonActionableSemanticHint(raw) ||
    isNonActionableAppointmentHint(raw) ||
    (hasExplicitPriceContextForAppointment(raw) &&
      !hasAppointmentIntentWord(raw))
  ) {
    return null;
  }

  const weekdayMap: Array<[RegExp, number]> = [
    [
      /\b(montag|monday|lundi|lunes|lunedi)(?:morgen|vormittag|nachmittag|abend)?\b/i,
      1,
    ],
    [
      /\b(dienstag|tuesday|mardi|martes|martedi)(?:morgen|vormittag|nachmittag|abend)?\b/i,
      2,
    ],
    [
      /\b(mittwoch|wednesday|mercredi|miercoles|mercoledi)(?:morgen|vormittag|nachmittag|abend)?\b/i,
      3,
    ],
    [
      /\b(donnerstag|thursday|jeudi|jueves|giovedi)(?:morgen|vormittag|nachmittag|abend)?\b/i,
      4,
    ],
    [
      /\b(freitag|friday|vendredi|viernes|venerdi)(?:morgen|vormittag|nachmittag|abend)?\b/i,
      5,
    ],
    [
      /\b(samstag|saturday|samedi|sabado|sabato)(?:morgen|vormittag|nachmittag|abend)?\b/i,
      6,
    ],
    [
      /\b(sonntag|sunday|dimanche|domingo|domenica)(?:morgen|vormittag|nachmittag|abend)?\b/i,
      7,
    ],
  ];

  const weekdayIndex =
    weekdayMap.find(([pattern]) => pattern.test(text))?.[1] || null;
  const hasNextWeek =
    /\b(naechste woche|nächste woche|next week|semaine prochaine|proxima semana|settimana prossima)\b/i.test(
      text,
    );
  const hasExplicitNextOccurrence =
    /\b(naechsten|nächsten|naechste|nächste|next|prochain|prochaine|prossimo|prossima|proximo|proxima)\b/i.test(
      text,
    );
  const hasToday = /\b(heute|today|aujourd'hui|hoy|oggi)\b/i.test(text);
  const hasTomorrow =
    /\b(morgen|tomorrow|demain|mañana|manana|domani)\b/i.test(text) &&
    !weekdayIndex;

  const dayPart = /vormittag|morning|matin|mattina/i.test(text)
    ? "Vorm."
    : /nachmittag|afternoon|apres midi|après-midi|tarde|pomeriggio/i.test(text)
      ? "Nachm."
      : /abend|evening|soir|noche|sera/i.test(text)
        ? "Abend"
        : "";

  const timeMatch =
    raw.match(/\b([01]?\d|2[0-3]):(\d{2})\b/) ||
    raw.match(/\b([01]?\d|2[0-3])\.(\d{2})\s*(?:uhr|h)\b/i) ||
    raw.match(/\b([01]?\d|2[0-3])\s*(?:uhr|h)\b/i);
  const time = timeMatch
    ? formatAppointmentTime(timeMatch[1], timeMatch[2])
    : "";

  const dateMatch = raw.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  const baseDate = parseAppointmentBaseDate(baseDateInput);
  const explicitDateObject =
    dateMatch && hasValidAppointmentDateParts(dateMatch[1], dateMatch[2])
      ? new Date(
          dateMatch[3]
            ? Number(
                dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3],
              )
            : baseDate.getFullYear(),
          Number(dateMatch[2]) - 1,
          Number(dateMatch[1]),
        )
      : null;

  const weekdayCandidateDate =
    !dateMatch && weekdayIndex
      ? resolveWeekdayAppointmentDate(weekdayIndex, baseDateInput, hasNextWeek)
      : null;
  const weekdayCandidateDeltaDays = weekdayCandidateDate
    ? Math.round(
        (new Date(
          weekdayCandidateDate.getFullYear(),
          weekdayCandidateDate.getMonth(),
          weekdayCandidateDate.getDate(),
        ).getTime() -
          new Date(
            baseDate.getFullYear(),
            baseDate.getMonth(),
            baseDate.getDate(),
          ).getTime()) /
          86400000,
      )
    : null;
  const ambiguousImmediateNextWeekday = Boolean(
    weekdayCandidateDate &&
      hasExplicitNextOccurrence &&
      !hasNextWeek &&
      weekdayCandidateDeltaDays === 1,
  );

  const computedAppointmentDate =
    explicitDateObject ||
    (hasToday ? baseDate : null) ||
    (hasTomorrow ? addDays(baseDate, 1) : null) ||
    (!ambiguousImmediateNextWeekday ? weekdayCandidateDate : null);

  const isAmbiguousSameWeekdayAppointment =
    computedAppointmentDate !== null &&
    !hasNextWeek &&
    !hasToday &&
    !hasTomorrow &&
    !explicitDateObject &&
    weekdayIndex !== null &&
    isSameAppointmentCalendarDay(computedAppointmentDate, baseDate);

  const shouldShowGenericAppointmentOnly =
    computedAppointmentDate !== null &&
    !hasNextWeek &&
    !hasToday &&
    !hasTomorrow &&
    !explicitDateObject &&
    (isAmbiguousSameWeekdayAppointment ||
      isAmbiguousElapsedSameDayAppointment(
        computedAppointmentDate,
        baseDateInput,
        time,
        dayPart,
      ));

  if (ambiguousImmediateNextWeekday) {
    return {
      label: "Termin klären",
      className: "bg-violet-100 text-violet-700 border border-violet-300",
    };
  }

  if (shouldShowGenericAppointmentOnly) {
    return {
      label: "Termin",
      className: "bg-violet-100 text-violet-700 border border-violet-300",
    };
  }

  const date = computedAppointmentDate
    ? formatAppointmentDate(computedAppointmentDate)
    : "";

  // Only show an outside appointment chip when there is a concrete day/date,
  // a relative date such as heute/morgen, or a concrete time.
  if (!date && !time) return null;

  const appointmentMoment = computedAppointmentDate
    ? buildAppointmentMoment(computedAppointmentDate, time, dayPart)
    : null;
  const parts = [date, time || dayPart].filter(Boolean);

  return getAppointmentBadgeVisual(appointmentMoment, parts, orderStatus);
};

const EXECUTION_ROLE_LABEL_KEYS_V17_90L176 = [
  "ausfuehrungsadresse",
  "ausfuehrungsort",
  "ausfuehrung",
  "arbeitsadresse",
  "arbeitsort",
  "einsatzadresse",
  "einsatzort",
  "objektadresse",
  "objekt",
  "baustelle",
  "work site",
  "job site",
  "adresse de travail",
];

const isBrokenWorkSiteRoleFragmentV17_90L176 = (
  value?: string | null,
): boolean => {
  const key = normalizeForMatch(value).replace(/\s+/g, " ").trim();
  if (!key) return true;
  if (EXECUTION_ROLE_LABEL_KEYS_V17_90L176.includes(key)) return true;

  // Structural suffix fragments such as "sort" from "Ausführungsort" are
  // field-label debris, not real object names. This does not classify service
  // vocabulary; it only validates address-role labels.
  return EXECUTION_ROLE_LABEL_KEYS_V17_90L176.some(
    (label) => key.length >= 3 && key.length < label.length && label.endsWith(key),
  );
};

type AppointmentDetail = {
  site: string;
  address: string;
  label: string;
  reason?: string;
};

const looksLikeAddressLine = (value?: string | null) => {
  const raw = compactText(value);
  const text = normalizeForMatch(raw);
  if (!raw || !text) return false;

  return (
    /\b\d{4,5}\b/.test(raw) ||
    /\b(strasse|straße|weg|platz|gasse|allee|ring|chemin|route|rue|road|street|avenue|av\.|hauptstrasse|aarauerstrasse|limmatweg|technoparkstrasse)\b/.test(
      text,
    )
  );
};

const isAppointmentContactTimeLine = (value?: string | null) => {
  const raw = compactText(value);
  const text = normalizeForMatch(raw);
  if (!text) return false;

  const hasConcreteAppointmentSignal = Boolean(
    hasAppointmentIntentWord(raw) &&
      (raw.match(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/) ||
        raw.match(/\b(?:heute|morgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i)) &&
      raw.match(/\b(?:[01]?\d|2[0-3])(?::|\.)\d{2}\b/),
  );
  if (hasConcreteAppointmentSignal) return false;

  if (CONTACT_TIME_WORD_PATTERN.test(text) && CALLBACK_TIME_PATTERN.test(text))
    return true;

  // Contact availability like "SMS erst ab 14:00 Uhr", "Mail erst nach 11:30"
  // or "telefonisch nur zwischen 15:00 und 16:00" is a contact window,
  // not an execution appointment.
  return (
    CONTACT_TIME_WORD_PATTERN.test(text) &&
    /(?:zwischen|von)\s+\d{1,2}(?::|\.)\d{2}\s*(?:uhr|h)?\s+(?:und|bis)\s+\d{1,2}(?::|\.)\d{2}\s*(?:uhr|h)?/.test(
      raw.toLowerCase(),
    )
  );
};

const hasExplicitPriceContextForAppointment = (value?: string | null) => {
  const raw = compactText(value);
  if (!raw) return false;
  return (
    /\b(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro)\s*\d+(?:[.,]\d{1,2})?\b/i.test(
      raw,
    ) ||
    /\b\d+(?:[.,]\d{1,2})?\s*(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro)\b/i.test(
      raw,
    )
  );
};

const hasAppointmentIntentWord = (value?: string | null) =>
  /\b(?:termin|datum|arbeitsbeginn|zeitfenster|appointment|rendez\s*vous|appuntamento)\b/i.test(
    normalizeForMatch(value),
  );

const hasExplicitAppointmentBadgeSignalV17_90L10 = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text) return false;

  const hasExplicitIntent = hasAppointmentIntentWord(value);
  const hasRelativeDay = /\b(?:heute|morgen|uebermorgen|übermorgen|today|tomorrow|demain|mañana|manana|domani)\b/.test(text);
  const hasWeekday = /\b(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b/.test(text);
  const hasExecutionAction = /\b(?:erledigen|ausfuehren|ausführen|machen|kommen|starten|beginnen|durchfuehren|durchführen|visite|passage|arrivare|venir|realizar|hacer)\b/.test(text);

  return hasExplicitIntent || ((hasRelativeDay || hasWeekday) && hasExecutionAction);
};

const isResourceAvailabilityTimeLineV17_90L84 = (
  value?: string | null,
) => {
  const text = normalizeForMatch(value);
  if (!text || hasAppointmentIntentWord(value)) return false;

  const hasTime = /\b(?:[01]?\d|2[0-3])(?::|\.)?\d{0,2}\s*(?:uhr|h)?\b/.test(
    text,
  );
  if (!hasTime) return false;

  return (
    /\b(?:lift|aufzug|rampe|empfang|rezeption|reception|zugang|badge|schluessel|schlussel|schlüssel)\b/.test(
      text,
    ) &&
    /\b(?:reserviert|verfuegbar|verfügbar|offen|oeffnet|öffnet|erst\s+ab|ab|nach)\b/.test(
      text,
    )
  );
};

const hasValidAppointmentDateParts = (day?: string, month?: string) => {
  const d = Number(day);
  const m = Number(month);
  return (
    Number.isInteger(d) &&
    Number.isInteger(m) &&
    d >= 1 &&
    d <= 31 &&
    m >= 1 &&
    m <= 12
  );
};

const normalizeAppointmentDateLabel = (value: string) => {
  const match = value.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  if (!match) return "";

  if (!hasValidAppointmentDateParts(match[1], match[2])) return "";

  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  const year = match[3]
    ? match[3].length === 2
      ? `20${match[3]}`
      : match[3]
    : "";

  return year ? `${day}.${month}.${year}` : `${day}.${month}.`;
};

const normalizeAppointmentTimeLabel = (value: string) => {
  const match =
    value.match(/\b([01]?\d|2[0-3]):(\d{2})\b/) ||
    value.match(/\b([01]?\d|2[0-3])\.(\d{2})\s*(?:uhr|h)?\b/i) ||
    value.match(/\b([01]?\d|2[0-3])\s*(?:uhr|h)\b/i);

  if (!match) return "";
  return formatAppointmentTime(match[1], match[2]);
};

const extractAppointmentDetailLabel = (value: string) => {
  const raw = compactText(value);
  if (
    !raw ||
    isAppointmentContactTimeLine(raw) ||
    isPreArrivalInstructionLine(raw) ||
    isResourceAvailabilityTimeLineV17_90L84(raw)
  )
    return "";
  if (
    hasExplicitPriceContextForAppointment(raw) &&
    !hasAppointmentIntentWord(raw)
  )
    return "";

  const date = normalizeAppointmentDateLabel(raw);
  const time = normalizeAppointmentTimeLabel(raw);
  const text = normalizeForMatch(raw);
  const dayPart = /vormittag|morning|matin/.test(text)
    ? "vormittags"
    : /nachmittag|afternoon|apres midi|après-midi/.test(text)
      ? "nachmittags"
      : /abend|evening|soir/.test(text)
        ? "abends"
        : "";

  // V16.95: A pure day-part without its own date/time is a reason/context
  // for an appointment, not a separate appointment. Example: after
  // "Termin: 08.07.2026 um 09:00", the line "Raum ist nur vormittags frei"
  // must stay a reason and must not create an extra "Termin vormittags".
  if (!date && !time) return "";
  return [date, time || (date ? dayPart : "")].filter(Boolean).join(" · ");
};

const cleanAppointmentReason = (value?: string | null) =>
  compactText(value)
    .replace(/^Grund\s*[:\-–—]\s*/i, "")
    .replace(/^Hinweis\s*[:\-–—]\s*/i, "")
    .replace(/^Kontakt\s+vor\s+Ort\s*[:\-–—]\s*Grund\s*[:\-–—]?\s*/i, "")
    .replace(/^Kontakt\s+vor\s+Ort\s*[:\-–—]\s*/i, "")
    .trim();

const appointmentDetailKey = (detail: AppointmentDetail) =>
  // V17.90L86: The same execution appointment may appear once in the semantic
  // notes and once in the raw customer text. The date/time identity is the
  // authoritative key; address/access context must not create duplicate chips.
  normalizeForMatch(detail.label);

const extractEmbeddedAppointmentLinesV17_90L80 = (
  value?: string | null,
): string[] => {
  const source = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!source.trim()) return [];

  const result: string[] = [];
  const patterns = [
    /\b((?:Termin|Zeitfenster)\s*[:\-–—]?\s*[\s\S]{1,220}?)(?=\b(?:ich\s+bin|je\s+suis|soy|eu\s+sou|sono|absender)\b|$)/giu,
    /\b((?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)\s+\d{1,2}[.\/-]\d{1,2}[\s\S]{0,120}?)(?=\b(?:ich\s+bin|je\s+suis|soy|eu\s+sou|sono|absender)\b|$)/giu,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      const line = cleanSpecialNotesSummaryLineV17_91(match[1])
        .replace(/\s+/g, " ")
        .trim();
      if (line && line.length <= 240) result.push(line);
    }
  }
  return Array.from(new Set(result));
};

const extractAppointmentDetailsFromRawText = (
  ...values: Array<string | null | undefined>
): AppointmentDetail[] => {
  const rawSource = values.filter(Boolean).join("\n");
  const rawLines = [
    ...rawSource
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split(/\n+/g),
    ...extractEmbeddedAppointmentLinesV17_90L80(rawSource),
  ]
    .map((line) => stripVisibleNoteMarkerV17_35(line))
    .filter(Boolean);

  const details: AppointmentDetail[] = [];
  let currentSite = "";
  let currentAddressParts: string[] = [];
  let lastDetailIndex = -1;

  const pushDetail = (line: string) => {
    // V17.90L88B: Only an explicit execution-appointment statement may create
    // an appointment detail. A resource/operation time such as "Anlage erst ab
    // 14:00" remains an ordinary hint and must never become a second Termin.
    if (!hasExplicitAppointmentBadgeSignalV17_90L10(line)) return;
    const label = extractAppointmentDetailLabel(line);
    if (!label) return;

    const detail: AppointmentDetail = {
      site: currentSite,
      address: currentAddressParts.join(" · "),
      label,
    };
    const key = appointmentDetailKey(detail);
    if (
      !key ||
      details.some((existing) => appointmentDetailKey(existing) === key)
    )
      return;

    details.push(detail);
    lastDetailIndex = details.length - 1;
  };

  for (const rawLine of rawLines) {
    const line = compactText(rawLine);
    const normalized = normalizeForMatch(line);
    if (!line || !normalized) continue;

    const worksiteMatch = line.match(
      /^(?:Arbeitsort|Ausführung|Ausfuehrung|Adresse\s+travaux|Arbeitsadresse)\s*\d*\s*[:\-–—]\s*(.*)$/i,
    );
    if (worksiteMatch) {
      const site = compactText(worksiteMatch[1]);
      currentSite = site || currentSite;
      currentAddressParts = [];
      lastDetailIndex = -1;
      continue;
    }

    if (
      currentSite &&
      currentAddressParts.length < 2 &&
      looksLikeAddressLine(line) &&
      !/^Termin\b/i.test(line) &&
      !/^Grund\b/i.test(line) &&
      !/^Leistung\b/i.test(line)
    ) {
      currentAddressParts.push(line);
      continue;
    }

    if (/^Termin\b/i.test(line) || extractAppointmentDetailLabel(line)) {
      pushDetail(line);
      continue;
    }

    if (/^Grund\s*[:\-–—]/i.test(line) && lastDetailIndex >= 0) {
      const reason = cleanAppointmentReason(line);
      if (reason)
        details[lastDetailIndex] = { ...details[lastDetailIndex], reason };
      continue;
    }
  }

  return details;
};

const extractAppointmentDetailsFromGroupedNotes = (
  parsedNotes: ReturnType<typeof splitSpecialNotes>,
): AppointmentDetail[] => {
  const details: AppointmentDetail[] = [];
  let currentSite = "";

  parsedNotes.jobHints.forEach((hint) => {
    const line = compactText(hint);
    if (!line) return;

    const groupedMatch = line.match(/^([^:]{2,160})\s*:\s*(.+)$/);
    const site = compactText(groupedMatch?.[1] || currentSite);
    const value = compactText(groupedMatch?.[2] || line);
    if (groupedMatch) currentSite = site;

    if (!hasExplicitAppointmentBadgeSignalV17_90L10(value)) return;
    const label = extractAppointmentDetailLabel(value);
    if (!label) return;

    const detail: AppointmentDetail = {
      site,
      address: "",
      label,
      reason: cleanAppointmentReason(
        value.replace(/^(?:Termin|Zeitfenster)\s*[:\-–—]?\s*/i, ""),
      ),
    };
    const key = appointmentDetailKey(detail);
    if (
      key &&
      !details.some((existing) => appointmentDetailKey(existing) === key)
    ) {
      details.push(detail);
    }
  });

  return details;
};

const compactAppointmentNoticeV17_90L86 = (
  value?: string | null,
): string => {
  const raw = compactText(value);
  if (!raw) return "";
  const minuteMatch = raw.match(/\b(\d{1,3})\s*Minuten?\s+(?:vorher|vor\s+Ankunft)\b/i);
  const channel = /\bSMS\b/i.test(raw)
    ? "per SMS melden"
    : /\bWhats\s*App|WhatsApp\b/i.test(raw)
      ? "per WhatsApp melden"
      : /\b(?:anrufen|telefonieren)\b/i.test(raw)
        ? "anrufen"
        : /\b(?:vorher|vor\s+Ankunft|Ankunft\s+vorher)\b/i.test(raw)
          ? "vorher melden"
          : "";
  if (minuteMatch?.[1]) {
    return `${minuteMatch[1]} Minuten vorher${channel ? ` ${channel}` : " melden"}`;
  }
  return channel;
};

const splitMergedOrderSourceSectionsV17_90L176 = (
  order: Order,
): string[] => {
  const source = [order.notes, order.audioTranscript]
    .filter(Boolean)
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!source) return [];

  const parts = source
    .split(
      /\n?\s*(?:[-─]{3,}\s*)?(?:Hauptauftrag:|Zusammengeführt mit:)\s*\n?/i,
    )
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 1 ? parts : [source];
};

const extractMergedSectionSiteLabelV17_90L176 = (
  section?: string | null,
): string => {
  const lines = String(section || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .map((line) => compactText(line))
    .filter(Boolean);
  const marker =
    /^(?:ausführung|ausfuehrung|ausführungsort|ausfuehrungsort|ausführungsadresse|ausfuehrungsadresse|arbeitsort|einsatzort|objekt|baustelle|work\s*site|job\s*site)\s*:?\s*(.*)$/i;
  const stop = /^(?:termin|leistung|leistungen|rechnung|rechnungsadresse|kontakt|telefon|e-?mail|sms|whatsapp|hinweis|besonderheiten)\b/i;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(marker);
    if (!match) continue;
    const inline = compactText(match[1]);
    if (
      inline &&
      !isBrokenWorkSiteRoleFragmentV17_90L176(inline) &&
      !looksLikeAddressLine(inline)
    ) {
      return inline;
    }
    for (let offset = 1; offset <= 3; offset += 1) {
      const candidate = compactText(lines[index + offset]);
      if (!candidate || stop.test(candidate)) break;
      if (looksLikeAddressLine(candidate)) continue;
      if (!isBrokenWorkSiteRoleFragmentV17_90L176(candidate)) return candidate;
    }
  }
  return "";
};

const extractMergedAppointmentLabelV17_90L176 = (line: string) => {
  const direct = extractAppointmentDetailLabel(line);
  const date = normalizeAppointmentDateLabel(line);
  const time = normalizeAppointmentTimeLabel(line);
  const weekday = line.match(
    /\b(?:nächsten|naechsten|kommenden|diesen)?\s*(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)\b/i,
  )?.[1];
  const relative = line.match(/\b(heute|morgen|übermorgen|uebermorgen)\b/i)?.[1];
  const dayLabel = date || weekday || relative || "";
  const structured = [dayLabel, time].filter(Boolean).join(" · ");
  return structured || direct;
};

const extractMergedAppointmentDetailsV17_90L176 = (
  order: Order,
): AppointmentDetail[] => {
  const sections = splitMergedOrderSourceSectionsV17_90L176(order);
  const workSites = Array.isArray(order.workSites)
    ? [...order.workSites].sort(
        (a, b) =>
          Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)) ||
          Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0),
      )
    : [];
  const merged =
    sections.length > 1 ||
    workSites.length > 1 ||
    (Array.isArray(order.originOrderIds) && order.originOrderIds.length > 1) ||
    order.reviewReasons?.includes("manual_order_merge") ||
    order.reviewReasons?.includes("double_merge");
  if (!merged) return [];

  const result: AppointmentDetail[] = [];
  sections.forEach((section, sectionIndex) => {
    const sectionKey = normalizeForMatch(section);
    const matchingSite =
      workSites.find((site) => {
        const addressKey = normalizeForMatch(site?.siteAddress);
        const placeKey = normalizeForMatch(
          [site?.sitePlz, site?.siteCity].filter(Boolean).join(" "),
        );
        return Boolean(
          (addressKey && sectionKey.includes(addressKey)) ||
            (placeKey && sectionKey.includes(placeKey)),
        );
      }) || workSites[sectionIndex];
    const inferredSite = extractMergedSectionSiteLabelV17_90L176(section);
    const storedSite = compactText(matchingSite?.siteName);
    const site =
      storedSite && !isBrokenWorkSiteRoleFragmentV17_90L176(storedSite)
        ? storedSite
        : inferredSite || compactText(matchingSite?.siteAddress);
    const address = [
      compactText(matchingSite?.siteAddress),
      [compactText(matchingSite?.sitePlz), compactText(matchingSite?.siteCity)]
        .filter(Boolean)
        .join(" "),
    ]
      .filter(Boolean)
      .join(" · ");

    const lines = [
      ...section
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split(/\n+|(?<=[.!?])\s+/g),
      ...extractEmbeddedAppointmentLinesV17_90L80(section),
    ]
      .map((line) => compactText(line))
      .filter(Boolean);

    for (const line of lines) {
      if (!hasExplicitAppointmentBadgeSignalV17_90L10(line)) continue;
      if (
        isAppointmentContactTimeLine(line) ||
        isPreArrivalInstructionLine(line) ||
        isResourceAvailabilityTimeLineV17_90L84(line)
      ) {
        continue;
      }
      const label = extractMergedAppointmentLabelV17_90L176(line);
      if (!label) continue;
      result.push({ site, address, label, reason: line });
    }
  });

  return dedupeAppointmentDetails(result);
};

const formatAppointmentDetailsTooltip = (details: AppointmentDetail[]) =>
  details
    .map((detail, index) => {
      const notice = compactAppointmentNoticeV17_90L86(detail.reason);
      const place = detail.site || detail.address;
      return `${index + 1}. ${[
        place ? `${place} — ${detail.label}` : detail.label,
        notice,
      ]
        .filter(Boolean)
        .join(" · ")}`;
    })
    .join("\n");

const compactSingleAppointmentTooltipV17_90L86 = (
  sourceLine: string,
  fallbackLabel: string,
) => {
  const date = normalizeAppointmentDateLabel(sourceLine);
  // Remove calendar dates before scanning times. Otherwise "22.06." is
  // misread as the clock time 22:06 and produces "22:06–08:30".
  const sourceWithoutDates = sourceLine.replace(
    /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/g,
    " ",
  );
  const times = Array.from(
    sourceWithoutDates.matchAll(
      /\b([01]?\d|2[0-3]):(\d{2})\b|\b([01]?\d|2[0-3])\.(\d{2})\s*(?:Uhr|h)\b/gi,
    ),
  ).map((match) =>
    formatAppointmentTime(match[1] || match[3], match[2] || match[4]),
  );
  const uniqueTimes = Array.from(new Set(times));
  const timeRange =
    uniqueTimes.length >= 2
      ? `${uniqueTimes[0]}–${uniqueTimes[1]}`
      : uniqueTimes[0] || "";
  const notice = compactAppointmentNoticeV17_90L86(sourceLine);
  return [date, timeRange, notice].filter(Boolean).join(" · ") || fallbackLabel;
};

const mergeAppointmentDetail = (
  existing: AppointmentDetail,
  incoming: AppointmentDetail,
): AppointmentDetail => ({
  site: existing.site || incoming.site,
  address: existing.address || incoming.address,
  label: existing.label || incoming.label,
  reason:
    (existing.reason || "").length >= (incoming.reason || "").length
      ? existing.reason
      : incoming.reason,
});

const dedupeAppointmentDetails = (details: AppointmentDetail[]) => {
  const result: AppointmentDetail[] = [];

  details.forEach((detail) => {
    const labelKey = normalizeForMatch(detail.label);
    if (!labelKey) return;

    const exactKey = appointmentDetailKey(detail);
    const exactIndex = result.findIndex(
      (existing) => appointmentDetailKey(existing) === exactKey,
    );
    if (exactIndex >= 0) {
      result[exactIndex] = mergeAppointmentDetail(result[exactIndex], detail);
      return;
    }

    const looseIndex = result.findIndex((existing) => {
      if (normalizeForMatch(existing.label) !== labelKey) return false;

      const existingHasPlace = Boolean(existing.site || existing.address);
      const incomingHasPlace = Boolean(detail.site || detail.address);

      // Collapse duplicate mentions of the same date/time when one source is
      // only a loose note without worksite/address context. Keep two entries
      // if both have different real places.
      return !existingHasPlace || !incomingHasPlace;
    });

    if (looseIndex >= 0) {
      result[looseIndex] = mergeAppointmentDetail(result[looseIndex], detail);
      return;
    }

    result.push(detail);
  });

  return result;
};

const appointmentDetailHasExecutionDayContextV17_90L178 = (
  detail: AppointmentDetail,
): boolean => {
  const source = [detail.label, detail.reason].filter(Boolean).join(" ");
  return Boolean(
    /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/.test(source) ||
      /\b(?:heute|morgen|uebermorgen|übermorgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i.test(
        source,
      ),
  );
};

const normalizeMergedAppointmentSitesV17_90L178 = (
  order: Order,
  details: AppointmentDetail[],
): AppointmentDetail[] => {
  const workSites = Array.isArray(order.workSites)
    ? [...order.workSites].sort(
        (a, b) =>
          Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)) ||
          Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0),
      )
    : [];

  return details.map((detail) => {
    const currentSite = compactText(detail.site);
    if (currentSite && !isBrokenWorkSiteRoleFragmentV17_90L176(currentSite)) {
      return detail;
    }

    const peer = details.find(
      (candidate) =>
        candidate !== detail &&
        normalizeForMatch(candidate.label) === normalizeForMatch(detail.label) &&
        Boolean(
          compactText(candidate.site) &&
            !isBrokenWorkSiteRoleFragmentV17_90L176(candidate.site),
        ),
    );
    if (peer) {
      return {
        ...detail,
        site: compactText(peer.site),
        address: compactText(detail.address) || compactText(peer.address),
      };
    }

    const addressKey = normalizeForMatch(detail.address);
    const reasonKey = normalizeForMatch(detail.reason);
    const matched = workSites.find((site) => {
      const siteAddressKey = normalizeForMatch(site?.siteAddress);
      const sitePlaceKey = normalizeForMatch(
        [site?.sitePlz, site?.siteCity].filter(Boolean).join(" "),
      );
      return Boolean(
        (siteAddressKey &&
          (addressKey.includes(siteAddressKey) || reasonKey.includes(siteAddressKey))) ||
          (sitePlaceKey &&
            (addressKey.includes(sitePlaceKey) || reasonKey.includes(sitePlaceKey))),
      );
    });

    const correctedSite = compactText(matched?.siteName);
    return correctedSite && !isBrokenWorkSiteRoleFragmentV17_90L176(correctedSite)
      ? { ...detail, site: correctedSite }
      : detail;
  });
};

const getMultipleAppointmentBadge = (
  order: Order,
  parsedNotes: ReturnType<typeof splitSpecialNotes>,
): ReviewBadge | null => {
  const callbackSource = [
    order.specialNotes,
    order.notes,
    order.audioTranscript,
    ...parsedNotes.jobHints,
  ]
    .filter(Boolean)
    .join("\n");
  const callbackTime = extractCallbackTimeHint(
    order.specialNotes,
    order.notes,
    order.audioTranscript,
    ...parsedNotes.jobHints,
  );
  const callbackTimeKey = normalizeForMatch(callbackTime);
  const callbackTimeDigits = callbackTimeKey.replace(/[^0-9]/g, "");

  // V17.90L175: A merged order can contain one structured appointment and
  // additional appointments only in the linked/raw source text. Always combine
  // all read-only sources before deduplication; never discard the raw source
  // merely because one structured appointment already exists.
  const mergedDetails = extractMergedAppointmentDetailsV17_90L176(order);
  // V17.90L177: Merge-Termine immer aus allen verfügbaren Quellen bilden.
  // L176 hat bei vorhandenen Merge-Details die strukturierten Hinweise komplett
  // verworfen. Dadurch blieb nach dem Zusammenführen häufig nur ein Termin übrig
  // und außen erschien gar kein Termine-Chip. Die Quellen sind read-only und
  // werden erst danach semantisch dedupliziert.
  const details = dedupeAppointmentDetails(
    normalizeMergedAppointmentSitesV17_90L178(order, [
      ...mergedDetails,
      ...extractAppointmentDetailsFromRawText(order.specialNotes),
      ...extractAppointmentDetailsFromGroupedNotes(parsedNotes),
      ...extractAppointmentDetailsFromRawText(order.notes, order.audioTranscript),
    ]),
  ).filter((detail) => {
    const source = [detail.site, detail.address, detail.label, detail.reason]
      .filter(Boolean)
      .join(" ");
    if (
      isAppointmentContactTimeLine(source) ||
      isResourceAvailabilityTimeLineV17_90L84(source)
    )
      return false;

    // Do not show a bare time as appointment if the same time is already used
    // by the callback/contact chip.
    const labelKey = normalizeForMatch(detail.label);
    const labelDigits = labelKey.replace(/[^0-9]/g, "");
    if (
      callbackTimeDigits &&
      !/\d{1,2}[./-]\d{1,2}/.test(detail.label) &&
      labelDigits &&
      callbackTimeDigits.includes(labelDigits)
    ) {
      return false;
    }

    // Parser/LLM sometimes writes "Termin 13:00" next to a callback note.
    // If there is no date and the overall source contains a callback/contact
    // instruction for that time, keep it out of the Termine chip.
    if (
      !appointmentDetailHasExecutionDayContextV17_90L178(detail) &&
      isAppointmentContactTimeLine(callbackSource)
    ) {
      return false;
    }

    return true;
  });

  if (details.length < 2) return null;

  return {
    key: "appointments_multiple",
    label: `Termine · ${details.length}`,
    className: "bg-violet-100 text-violet-700 border border-violet-300",
    tooltip: formatAppointmentDetailsTooltip(details),
  };
};


const cleanSpecialNotesSummaryLineV17_91 = (value?: string | null) => {
  const line = compactText(stripVisibleNoteMarkerV17_35(value))
    .replace(/^[-•*]\s*/g, "")
    .replace(/^\s*\[(?:HINWEIS|INFO|NOTIZ|GEFAHR|WARNUNG|WARNHINWEIS)\]\s*/i, "")
    .replace(/^\s*(?:wichtige informationen|ausgewählter hinweis|weitere besonderheiten|besonderheiten)\s*:?\s*/i, "")
    .trim();
  if (!line || /^(?:whatsapp|sms|telefon|e-?mail|kundennachricht)\s*:?$/i.test(line)) return "";
  return line.charAt(0).toUpperCase() + line.slice(1);
};

const orderInfoTokensV17_66 = (value: string) => {
  const stop = new Set([
    "bitte", "vorher", "zuerst", "nur", "der", "die", "das", "den", "dem",
    "ein", "eine", "einer", "und", "oder", "mit", "bei", "im", "in", "am",
    "ist", "sind", "wird", "werden", "soll", "sollen", "kontakt", "bevorzugt",
    "waehrend", "während", "daher", "deshalb", "bleibt", "geoeffnet", "geöffnet",
    "reinigung",
  ]);
  return new Set(
    normalizeForMatch(value)
      .split(/\s+/g)
      .filter((token) => token.length >= 3 && !stop.has(token)),
  );
};

const orderInfoLinesEquivalentV17_66 = (left: string, right: string) => {
  const a = normalizeForMatch(left);
  const b = normalizeForMatch(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 12 && longer.includes(shorter) && shorter.length / longer.length >= 0.58) return true;
  const aTokens = orderInfoTokensV17_66(left);
  const bTokens = orderInfoTokensV17_66(right);
  if (aTokens.size < 2 || bTokens.size < 2) return false;
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  const smallerSize = Math.min(aTokens.size, bTokens.size);
  return overlap >= 2 && overlap / smallerSize >= 0.72;
};

// V17.90L280: Localize canonical display lines from the already persisted
// automatic translation. This changes only the rendered text; the sealed
// canonical roles, facts and customer message remain untouched.
const splitStoredTranslationSectionsV17_90L280 = (value?: string | null) => {
  const source = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const marker = source.match(
    /(?:^|\n)\s*(?:---\s*)?(?:Übersetzung\s*\(automatisch\)|Deutsche\s+Übersetzung)(?:\s*---)?\s*(?:\n|$)/i,
  );
  if (!marker || marker.index == null) return null;
  const translationStart = marker.index + marker[0].length;
  return {
    original: source.slice(0, marker.index).trim(),
    translation: source.slice(translationStart).trim(),
  };
};

const splitStoredTranslationSentencesV17_90L280 = (value: string) =>
  String(value || "")
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => compactText(line))
    .filter((line) => line.length >= 4 && line.length <= 700);

const infoLineInvariantTokensV17_90L280 = (value: string) =>
  Array.from(new Set(String(value || "").match(/\b\d+(?:[.,]\d+)?\b/g) || [])).sort();

const infoLineHasNegationV17_90L280 = (value: string) =>
  /\b(?:nicht|kein|keine|keinen|ohne|no|not|never|sans|pas|non|sin|senza)\b/i.test(
    normalizeForMatch(value),
  );

const localizeOrderInfoLineV17_90L280 = (
  line: string,
  storedNotes?: string | null,
) => {
  const sections = splitStoredTranslationSectionsV17_90L280(storedNotes);
  const rawLine = compactText(line);
  if (!sections || !rawLine) return rawLine;

  const labelMatch = rawLine.match(/^([^:\n]{2,40}):\s*(.+)$/);
  const label = labelMatch?.[1] || "";
  const body = compactText(labelMatch?.[2] || rawLine);
  const originalSentences = splitStoredTranslationSentencesV17_90L280(
    sections.original,
  );
  const translatedSentences = splitStoredTranslationSentencesV17_90L280(
    sections.translation,
  );

  if (
    translatedSentences.some((sentence) =>
      orderInfoLinesEquivalentV17_66(sentence, body),
    )
  ) {
    return rawLine;
  }

  const sourceIndex = originalSentences.findIndex((sentence) =>
    orderInfoLinesEquivalentV17_66(sentence, body),
  );
  if (sourceIndex < 0) return rawLine;

  const bodyInvariants = infoLineInvariantTokensV17_90L280(body).join("|");
  const bodyNegated = infoLineHasNegationV17_90L280(body);
  for (const index of [sourceIndex, sourceIndex - 1, sourceIndex + 1]) {
    const candidate = compactText(translatedSentences[index]);
    if (!candidate) continue;
    if (infoLineInvariantTokensV17_90L280(candidate).join("|") !== bodyInvariants) {
      continue;
    }
    if (infoLineHasNegationV17_90L280(candidate) !== bodyNegated) continue;
    return label ? `${label}: ${candidate}` : candidate;
  }

  return rawLine;
};

const localizeOrderInfoSummaryV17_90L280 = (
  info: OrderInfoSummaryV17_65,
  storedNotes?: string | null,
): OrderInfoSummaryV17_65 => ({
  safety: info.safety.map((line) =>
    localizeOrderInfoLineV17_90L280(line, storedNotes),
  ),
  primary: info.primary.map((line) =>
    localizeOrderInfoLineV17_90L280(line, storedNotes),
  ),
  additional: info.additional.map((line) =>
    localizeOrderInfoLineV17_90L280(line, storedNotes),
  ),
});

const uniqueOrderInfoLinesV17_66 = (lines: Array<string | null | undefined>) => {
  const result: string[] = [];
  lines.forEach((raw) => {
    const line = cleanSpecialNotesSummaryLineV17_91(raw);
    if (!line) return;
    if (result.some((existing) => orderInfoLinesEquivalentV17_66(existing, line))) return;
    result.push(line);
  });
  return result;
};

type OrderInfoSummaryV17_65 = {
  safety: string[];
  primary: string[];
  additional: string[];
};

const isPrimaryOrderInfoHintV17_65 = (value?: string | null) => {
  const role = classifySpecialNoteRoleV17_90L93(value);
  if (role === "communication" || role === "appointment" || role === "access") {
    return true;
  }
  const text = normalizeForMatch(value);
  if (!text) return false;
  return /\b(?:ankunft|ankommen|vorher|zuerst|genaue\s+zeit|ankuendigung|melden)\b/.test(text);
};

const extractOrderAppointmentSnippetsV17_65 = (value?: string | null) => {
  const source = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!source.trim()) return [];
  const weekday = "(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)";
  const result: string[] = [...extractEmbeddedAppointmentLinesV17_90L80(source)];
  const patterns = [
    new RegExp(
      String.raw`(?:^|\n)\s*((?:termin|zeitfenster)\s*[:\-–—]?\s*[^\n]{1,180})`,
      "gi",
    ),
    new RegExp(
      String.raw`(?:^|\n)\s*((?:am\s+)?${weekday}[^\n]{1,180})`,
      "gi",
    ),
    /(?:^|\n)\s*((?:genaue\s+ankunft|ankunft)\s+[^\n]{1,180})/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      const line = cleanSpecialNotesSummaryLineV17_91(match[1]);
      if (line) result.push(line);
    }
  }
  return Array.from(new Set(result));
};
const extractOrderImportantInstructionLinesV17_65 = (value?: string | null) =>
  String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/g)
    .map(cleanSpecialNotesSummaryLineV17_91)
    .filter(
      (line) =>
        line.length > 0 &&
        line.length <= 220 &&
        /\b(?:nichts verschieben|nicht verschieben|keine geraete|keine geräte|nicht ausstecken|nicht bewegen|nicht anfassen|nicht einfach|ankuendigung|ankündigung|empfang|besucherausweis|kontakt vor ort|sms|whatsapp|ankunft)\b/i.test(line),
    );

type InlineOrderInfoSnippetsV17_90L80 = {
  primary: string[];
  additional: string[];
};

const extractInlineOrderInfoSnippetsV17_90L80 = (
  value?: string | null,
): InlineOrderInfoSnippetsV17_90L80 => {
  const source = String(value || "").replace(/\s+/g, " ").trim();
  if (!source) return { primary: [], additional: [] };

  const primary: string[] = [];
  const additional: string[] = [];
  const push = (target: string[], valueToAdd?: string | null) => {
    const cleaned = cleanSpecialNotesSummaryLineV17_91(valueToAdd)
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned && !target.some((line) => orderInfoLinesEquivalentV17_66(line, cleaned))) {
      target.push(cleaned);
    }
  };

  const contactPatterns = [
    /(?:kontakt(?:\s+vor\s+ort)?|ansprech(?:person|partner)(?:\s+vor\s+ort)?|vor\s+ort(?:\s+ist)?|contact\s+sur\s+place|contatto\s+sul\s+posto|contacto\s+en\s+sitio|dort)\s*[:.,-]?\s*([\p{L}][\p{L}'’\-]+(?:\s+[\p{L}][\p{L}'’\-]+){0,2})\s*[,;:]?\s*(?:telefon\s*:?\s*)?(\+?\d[\d\s()./-]{6,}\d)/iu,
  ];
  for (const pattern of contactPatterns) {
    const match = source.match(pattern);
    if (!match) continue;
    const around = source.slice(
      Math.max(0, (match.index || 0) - 20),
      Math.min(source.length, (match.index || 0) + match[0].length + 150),
    );
    const parts = [match[1].trim(), match[2].replace(/\s+/g, " ").trim()];
    if (/\bwhatsapp\b/i.test(around)) parts.push("nur WhatsApp");
    else if (/\bsms\b/i.test(around)) parts.push("nur SMS");
    if (/\b(?:nicht\s+(?:(?:im\s+)?büro\s+)?anrufen|nicht\s+telefonisch)\b/i.test(around)) {
      parts.push("nicht telefonisch");
    }
    push(primary, `Vor Ort: ${parts.join(" · ")}`);
    break;
  }

  extractEmbeddedAppointmentLinesV17_90L80(source).forEach((line) =>
    push(primary, line),
  );

  const senderMatch = source.match(
    /(?:ich\s+bin|je\s+suis|soy|eu\s+sou|sono)\s+([\p{L}][\p{L}'’\-]+)[^.!?]{0,100}?(?:leit\w*|schick\w*)[^.!?]{0,45}?nur\s+weiter[^.!?]{0,100}/iu,
  );
  if (senderMatch) {
    const suffix = /nicht\s+als\s+kunde\s+speichern/i.test(senderMatch[0])
      ? " · nicht als Kunde speichern"
      : "";
    push(primary, `Absender: ${senderMatch[1]} leitet nur weiter${suffix}`);
  }

  const parkingMatch = source.match(
    /(?:lieferwagen\s+)?(?:nur\s+)?(?:auf\s+)?(?:besucherparkplatz|parkplatz(?:\s+für\s+[\p{L}-]+)?|parkplatz\s+installateure)(?:\s+nummer)?\s*\d+/iu,
  );
  if (parkingMatch) push(additional, parkingMatch[0]);

  const ladderMatch = source.match(/[^.!?]{0,35}\bleiter\b[^.!?]{0,45}\bmitnehmen\b/iu);
  if (ladderMatch) push(additional, ladderMatch[0]);

  const quietMatch = source.match(
    /(?:bewohner\s+schlafen[^.!?]{0,80}|bitte\s+ruhig\s+arbeiten)/iu,
  );
  if (quietMatch) push(additional, quietMatch[0]);

  return { primary, additional };
};

const isAdditionalOrderInfoHintV17_90L80 = (value?: string | null) => {
  const role = classifySpecialNoteRoleV17_90L93(value);
  if (role === "parking" || role === "equipment" || role === "operational") {
    return true;
  }
  const text = normalizeForMatch(value);
  return /\b(?:bewohner\s+schlafen|ruhig\s+arbeiten|nicht\s+blockieren|nicht\s+zustellen)\b/.test(
    text,
  );
};

const isOperationalPrimaryOrderInfoHintV17_90L80 = (
  value?: string | null,
) => {
  const text = normalizeForMatch(value);
  return /\b(?:genaue\s+zeit|kontakt|ansprechperson|vor\s+ort|whatsapp|sms|anrufen|telefonisch|termin|ankunft|nicht\s+einfach|stromabschaltung|freigabe)\b/.test(
    text,
  );
};

const isParkingOrderInfoLineV17_90L101 = (value?: string | null) => {
  const role = classifySpecialNoteRoleV17_90L93(value);
  return role === "parking" || hasParkingReference(value);
};

const extractOrderOperationalContactLineV17_90L101 = (
  ...values: Array<string | null | undefined>
): string => {
  const raw = values
    .map((value) => String(value || ""))
    .filter(Boolean)
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!raw.trim()) return "";

  const marker = raw.match(
    /\b(?:kontakt\s+vor\s+ort|kontaktperson\s+vor\s+ort|ansprechperson\s+vor\s+ort|vor\s+ort(?:\s+ist(?:\s+dieses\s+mal)?)?|on[-\s]?site\s+contact|contact\s+sur\s+place|contatto\s+sul\s+posto|contacto\s+en\s+sitio)\b/i,
  );
  if (!marker || marker.index == null) return "";

  const scoped = raw.slice(marker.index, marker.index + 420);
  const identity = scoped.match(
    /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d[\d\s().\/-]{6,}\d)/i,
  );
  if (!identity || identity.index == null) return "";

  const identityValue = compactText(identity[0]);
  const isPhone = /\d/.test(identityValue) && !identityValue.includes("@");
  if (isPhone) {
    const digits = identityValue.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return "";
  }

  let nameSource = scoped
    .slice(marker[0].length, identity.index)
    .replace(/^\s*[:.,;\-–—]*\s*(?:ist\s+(?:dieses\s+mal\s+)?)?/i, "")
    .replace(/\b(?:erreichbar|zu\s+erreichen|available|reachable)\s*(?:unter|at|via)?\s*$/i, "")
    .replace(/\b(?:tel\.?|telefon|phone|mobile|mobil|handy|natel|unter)\s*[:.]?\s*$/i, "")
    .replace(/[\s:.,;\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const nameMatch = nameSource.match(
    /((?:(?:Herr|Frau|Mr\.?|Mrs\.?|Ms\.?|Mme\.?)\s+)?[A-ZÀ-ÖØ-ÞÄÖÜ][\p{L}'’.-]+(?:\s+[A-ZÀ-ÖØ-ÞÄÖÜ][\p{L}'’.-]+){0,3})$/u,
  );
  const name = cleanContactDisplayNameV17_90L91(nameMatch?.[1] || nameSource);
  const context = scoped.slice(
    Math.max(0, identity.index - 30),
    Math.min(scoped.length, identity.index + identity[0].length + 250),
  );
  const parts = [name, identityValue];
  if (/\b(?:whats\s*app|whatsapp)\b/i.test(context)) parts.push("nur WhatsApp");
  else if (/\b(?:sms|text\s+message|kurznachricht)\b/i.test(context)) parts.push("nur SMS");
  else if (/\b(?:e\s*mail|e-mail|email|mail|courriel)\b/i.test(context)) parts.push("nur E-Mail");
  if (
    /\b(?:nicht\s+(?:direkt\s+|telefonisch\s+)?anrufen|nicht\s+telefonisch|do\s+not\s+call|don['’]?t\s+call|no\s+calls?)\b/i.test(
      context,
    )
  ) {
    parts.push("nicht telefonisch");
  }
  return `Kontakt vor Ort: ${parts.filter(Boolean).join(" · ")}`;
};

function activeRecognitionDisplayTextsV17_90L280(order: {
  reviewReasons?: string[] | null;
  notes?: string | null;
}): string[] {
  const result: string[] = [];
  for (const reason of order.reviewReasons || []) {
    const value = String(reason || "");
    if (!value.startsWith("intake_risk:recognition_review:")) continue;
    try {
      const payload = JSON.parse(
        decodeURIComponent(value.slice("intake_risk:recognition_review:".length)),
      ) as RecognitionReviewPayloadV17_90L69;
      for (const rawText of [payload.relatedRoleText, payload.sourceText]) {
        const text = compactText(rawText);
        if (!text) continue;
        result.push(text);
        const localized = localizeOrderInfoLineV17_90L280(text, order.notes);
        if (localized) result.push(localized);
      }
    } catch {}
  }
  return uniqueOrderInfoLinesV17_66(result);
}

function canonicalOrderInfoForOrderV17_90L252(
  order: {
    reviewReasons?: string[] | null;
    notes?: string | null;
    specialNotes?: string | null;
    audioTranscript?: string | null;
  },
  snapshot: NonNullable<ReturnType<typeof getCanonicalIntakeV2>>,
): OrderInfoSummaryV17_65 {
  const info = localizeOrderInfoSummaryV17_90L280(
    canonicalOrderInfoV2(snapshot),
    order.notes,
  );
  const explicitContact = extractDocumentContactFallback(
    order.notes,
    order.audioTranscript,
    order.specialNotes,
  );
  const explicitTarget =
    explicitContact.channel === "email"
      ? explicitContact.email
      : explicitContact.phone;
  const enrichedPrimary =
    explicitContact.title && explicitTarget
      ? uniqueOrderInfoLinesV17_66([
          ...info.primary.filter((line) => {
            const text = normalizeForMatch(line);
            const isAppointment =
              /\b(?:termin|datum|uhr|zeitfenster|ankunft|arbeitsbeginn)\b/.test(
                text,
              ) || /\b\d{1,2}[.:]\d{2}\b/.test(text);
            const isCommunication =
              /\b(?:kontakt|kontaktperson|ansprechperson|whatsapp|sms|e mail|email|mail|telefon|anrufen|melden)\b/.test(
                text,
              );
            return !isCommunication || isAppointment;
          }),
          explicitContact.title,
        ])
      : info.primary;
  const suppressed = activeRecognitionDisplayTextsV17_90L280(order);
  const keep = (line: string) =>
    !suppressed.some((reviewText) =>
      orderInfoLinesEquivalentV17_66(line, reviewText),
    );
  return {
    ...info,
    primary:
      suppressed.length === 0
        ? enrichedPrimary
        : enrichedPrimary.filter(keep),
    additional:
      suppressed.length === 0
        ? info.additional
        : info.additional.filter(keep),
  };
}

const buildOrderInfoSummaryV17_65 = (
  order: {
    specialNotes?: string | null;
    notes?: string | null;
    audioTranscript?: string | null;
    intakeSchemaVersion?: string | null;
    intakeSnapshot?: unknown;
    reviewReasons?: string[] | null;
  },
  parsedNotes: ReturnType<typeof splitSpecialNotes>,
): OrderInfoSummaryV17_65 => {
  const canonicalSnapshotV2 = getCanonicalIntakeV2(order);
  if (canonicalSnapshotV2)
    return canonicalOrderInfoForOrderV17_90L252(order, canonicalSnapshotV2);
  if (isIntakeV2Order(order)) {
    return {
      safety: ["Kanonischer Intake beschädigt – Auftrag prüfen"],
      primary: [],
      additional: [],
    };
  }

  const isDogLine = (line: string) =>
    /\b(?:hund|dog|chien)\b/i.test(normalizeForMatch(line));
  // V17.90L83: The Info chip/dialog must be built from the normalized
  // operational notes. The full customer message is only a legacy fallback.
  // V17.90L108B: Render protected role markers directly and avoid raw-text reclassification.
  // Mixing audioTranscript back into an already structured order reintroduced
  // English/raw forwarding sentences and duplicated access instructions.
  const normalizedSpecialNotes = String(order.specialNotes || "").trim();
  const hasProtectedRoleMarkersV17_90L108 =
    /\[(?:GEFAHR|WARNUNG|WARNHINWEIS|HINWEIS|INFO|NOTIZ)\]/i.test(
      normalizedSpecialNotes,
    );
  const structuredRoleDisplaySourceV17_90L108 = [
    ...(parsedNotes.safetyWarnings || []),
    ...(parsedNotes.jobHints || []),
  ]
    .map((line) => compactText(line))
    .filter(Boolean)
    .join("\n");
  const source = hasProtectedRoleMarkersV17_90L108
    ? structuredRoleDisplaySourceV17_90L108
    : normalizedSpecialNotes ||
      String(order.notes || "").trim() ||
      String(order.audioTranscript || "").trim();
  const inline = extractInlineOrderInfoSnippetsV17_90L80(source);
  const hasStructuredContactV17_90L108 = (parsedNotes.jobHints || []).some(
    (line) => /^\s*Kontakt\s+vor\s+Ort\s*:/i.test(compactText(line)),
  );
  const rawOperationalContact = hasStructuredContactV17_90L108
    ? ""
    : extractOrderOperationalContactLineV17_90L101(
        order.notes,
        order.audioTranscript,
      );

  const splitInfoClausesV17_90L81 = (line: string) =>
    compactText(line)
      .split(
        /(?:[.;]\s+|(?=\b(?:für\s+[^.!?]{0,35}\bleiter\b|lieferwagen\b|besucherparkplatz\b|parkplatz\b|bewohner\s+schlafen\b|bitte\s+ruhig\s+arbeiten\b|genaue\s+zeit\b|termin\b)\b))/i,
      )
      .map((part) => compactText(part))
      .filter(Boolean);

  const rawSafety = uniqueOrderInfoLinesV17_66([
    ...(parsedNotes.safetyWarnings || []).flatMap(splitInfoClausesV17_90L81),
    ...(parsedNotes.jobHints || []).filter(isDogLine),
  ]).filter((line) => !isParkingOrderInfoLineV17_90L101(line));
  const safety = rawSafety.filter((line) => {
    const role = classifySpecialNoteRoleV17_90L93(line);
    return role === "safety";
  });
  const reclassifiedPrimary = rawSafety.filter((line) => {
    const role = classifySpecialNoteRoleV17_90L93(line);
    return role === "communication" || role === "appointment" || role === "access";
  });
  const reclassifiedAdditional = rawSafety.filter((line) => {
    const role = classifySpecialNoteRoleV17_90L93(line);
    return role === "equipment" || role === "operational" || role === "unknown";
  });

  const appointmentSourceV17_90L106 = hasProtectedRoleMarkersV17_90L108
    ? (parsedNotes.jobHints || []).join("\n")
    : [
        normalizedSpecialNotes,
        String(order.notes || "").trim(),
        String(order.audioTranscript || "").trim(),
      ]
        .filter(Boolean)
        .join("\n");
  const appointmentLines = extractOrderAppointmentSnippetsV17_65(
    appointmentSourceV17_90L106,
  );
  const importantRawLines = extractOrderImportantInstructionLinesV17_65(source);
  const structuredContactHintsV17_90L107 = (parsedNotes.jobHints || []).filter(
    (line) => /^\s*Kontakt\s+vor\s+Ort\s*:/i.test(compactText(line)),
  );
  const otherPrimaryJobHintsV17_90L107 = (parsedNotes.jobHints || [])
    .filter(isPrimaryOrderInfoHintV17_65)
    .filter((line) => !isParkingOrderInfoLineV17_90L101(line))
    .filter(
      (line) => !/^\s*Kontakt\s+vor\s+Ort\s*:/i.test(compactText(line)),
    );

  const primary = uniqueOrderInfoLinesV17_66([
    // V17.90L107: The structured on-site contact generated by intake is the
    // authoritative display source. Narrative phrases such as "vorher SMS" or
    // "WhatsApp bevorzugt" may describe the channel, but may never become the
    // person's name or replace the structured contact identity.
    ...structuredContactHintsV17_90L107,
    ...inline.primary,
    rawOperationalContact,
    ...otherPrimaryJobHintsV17_90L107,
    ...appointmentLines,
    ...importantRawLines.filter(isPrimaryOrderInfoHintV17_65),
    ...reclassifiedPrimary,
  ]).filter(
    (line) =>
      !safety.some((warning) =>
        orderInfoLinesEquivalentV17_66(warning, line),
      ),
  );
  const additional = uniqueOrderInfoLinesV17_66([
    ...inline.additional,
    ...(parsedNotes.jobHints || []).filter(
      (line) =>
        !isDogLine(line) &&
        !isPrimaryOrderInfoHintV17_65(line) &&
        !isParkingOrderInfoLineV17_90L101(line),
    ),
    ...importantRawLines.filter(
      (line) =>
        !isPrimaryOrderInfoHintV17_65(line) &&
        !isParkingOrderInfoLineV17_90L101(line),
    ),
    ...reclassifiedAdditional,
  ]).filter(
    (line) =>
      !safety.some((warning) =>
        orderInfoLinesEquivalentV17_66(warning, line),
      ) &&
      !primary.some((hint) => orderInfoLinesEquivalentV17_66(hint, line)),
  );
  return { safety, primary, additional };
};

const cleanContactDisplayNameV17_90L91 = (value?: string | null) => {
  const compact = compactText(value || "")
    .replace(/^[\s,;:·\-–—]+|[\s,;:·\-–—]+$/g, "")
    .trim();
  if (!compact) return "";

  const tokens = compact.split(/\s+/g);
  const result: string[] = [];
  let index = 0;
  if (/^(?:Herr|Frau|Mr\.?|Mrs\.?|Ms\.?|Mme\.?|M\.)$/i.test(tokens[0] || "")) {
    result.push(tokens[0]);
    index = 1;
  }
  for (; index < tokens.length && result.length < 5; index += 1) {
    const token = tokens[index].replace(/^[,;:·]+|[,;:·]+$/g, "");
    if (!/^[A-ZÀ-ÖØ-ÞÄÖÜ][\p{L}'’.-]*$/u.test(token)) break;
    result.push(token);
  }

  return result.length >= (result[0] && /^(?:Herr|Frau|Mr|Mrs|Ms|Mme|M)/i.test(result[0]) ? 2 : 1)
    ? result.join(" ")
    : compact;
};


const isInvalidContactDisplayNameV17_90L113 = (value?: string | null) => {
  const key = normalizeForMatch(value);
  if (!key) return true;
  return /^(?:termin|kontakt|sms|whatsapp|telefon|anruf|rueckruf|ruckruf|zeit|einsatz|intervention|vorher|minutes?|minuten?)$/.test(
    key,
  );
};

const extractContactNameBeforePhoneV17_90L113 = (
  line?: string | null,
  phone?: string | null,
) => {
  const source = compactText(line);
  if (!source || !phone) return "";
  const phoneIndex = source.indexOf(phone);
  const beforePhone = (phoneIndex >= 0 ? source.slice(0, phoneIndex) : source)
    .replace(/\b(?:kontakt\s+vor\s+ort|kontakt|ansprechperson|vor\s+ort|termin|einsatz|intervention)\s*:?/gi, " ")
    .replace(/\b(?:nur\s+)?(?:sms|whatsapp|telefon|anrufen|rueckruf|rückruf|call)\s+(?:an|bei)?\s*/gi, " ")
    .replace(/\b\d{1,2}[.:]\d{2}\b/g, " ")
    .replace(/\b\d{1,2}[.]\d{1,2}[.]?\b/g, " ")
    .replace(/\b(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const matches = Array.from(
    beforePhone.matchAll(
      /\b([A-ZÄÖÜÀ-ÖØ-Þ][\p{L}'’.-]+(?:\s+[A-ZÄÖÜÀ-ÖØ-Þ][\p{L}'’.-]+){0,3})\b/gu,
    ),
  )
    .map((match) => cleanContactDisplayNameV17_90L91(match[1] || ""))
    .filter((candidate) => !isInvalidContactDisplayNameV17_90L113(candidate));
  return matches.at(-1) || "";
};

const normalizeAccessDisplayLineV17_90L113 = (value?: string | null) =>
  compactText(value)
    .replace(/\bbadge\s+d[’']?acc[eè]s\b/gi, "Zugangsausweis")
    .replace(/\baccess\s+badge\b/gi, "Zugangsausweis")
    .replace(/\bbadge\s+de\s+acceso\b/gi, "Zugangsausweis")
    .replace(/\bbadge\s+di\s+accesso\b/gi, "Zugangsausweis");

const compactImportantInfoLinesV17_90L73 = (lines: string[]): string[] => {
  const source = Array.from(
    new Set(
      (lines || [])
        .map((line) => compactText(line))
        .filter(Boolean),
    ),
  );
  if (source.length === 0) return [];

  const result: string[] = [];
  const pushUnique = (value: string) => {
    const cleaned = compactText(value)
      .replace(/\s+([,.;:])/g, "$1")
      .replace(/\s*[|]\s*/g, " · ")
      .trim();
    if (!cleaned) return;
    if (
      !result.some(
        (existing) => normalizeForMatch(existing) === normalizeForMatch(cleaned),
      )
    ) {
      result.push(cleaned);
    }
  };

  const phonePatternV17_90L81 = /\+?\d[\d\s().\/-]{6,}\d/g;
  const isUsablePhoneV17_90L81 = (value: string) => {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15;
  };
  const canonicalContactLine = source.find((line) =>
    /^\s*(?:\[(?:HINWEIS|INFO|NOTIZ)\]\s*)?Kontakt\s+vor\s+Ort\s*:/i.test(
      line,
    ),
  );
  const contactLine =
    canonicalContactLine ||
    source
      .filter(
        (line) =>
          /\b(?:kontakt\s+vor\s+ort|ansprechperson|vor\s+ort|contact\s+sur\s+place|dort)\b/i.test(
            line,
          ) && Boolean(line.match(phonePatternV17_90L81)),
      )
      .sort((left, right) => {
        const score = (line: string) =>
          (/\b(?:kontakt\s+vor\s+ort|ansprechperson|vor\s+ort|contact\s+sur\s+place|dort)\b/i.test(line) ? 10 : 0) +
          (/\b[A-ZÄÖÜ][\p{L}'’\-]+(?:\s+[A-ZÄÖÜ][\p{L}'’\-]+){1,2}\b/u.test(line) ? 5 : 0) +
          (/\b(?:whatsapp|sms|anrufen|telefon)\b/i.test(line) ? 2 : 0);
        return score(right) - score(left);
      })[0] ||
    source.find(
      (line) =>
        /\b(?:kontakt\s+vor\s+ort|vor\s+ort|whatsapp|sms|telefon|anrufen|anruf)\b/i.test(
          line,
        ) && Boolean(line.match(phonePatternV17_90L81)),
    );
  const contactPhone =
    (contactLine?.match(phonePatternV17_90L81) || [])
      .map((value) => value.replace(/\s+/g, " ").trim())
      .find(isUsablePhoneV17_90L81) || "";
  // V17.90L104: A contact summary requires an actual contact line. Do not
  // borrow a phone/name from the joined appointment text; that produced
  // displays such as "Kontakt: Termin".
  const phone = contactPhone;
  if (contactLine && phone) {
    const line = contactLine;
    const structuredContactBody = canonicalContactLine
      ? canonicalContactLine
          .replace(
            /^\s*(?:\[(?:HINWEIS|INFO|NOTIZ)\]\s*)?Kontakt\s+vor\s+Ort\s*:\s*/i,
            "",
          )
          .trim()
      : "";
    const structuredName =
      structuredContactBody && phone
        ? structuredContactBody
            .slice(0, Math.max(0, structuredContactBody.indexOf(phone)))
            .replace(
              /\b(?:tel(?:efon)?|phone|mobile|handy|natel)\.?\s*:?\s*$/i,
              "",
            )
            .replace(/[\s,;·:\-–—]+$/g, "")
            .trim()
        : "";
    const nameMatch = line.match(
      /(?:kontakt\s+vor\s+ort\s*:?|vor\s+ort(?:\s+ist)?\s*:?|ansprechperson\s*:?|kontakt\s*:|dort\s+)?\s*([A-ZÄÖÜ][\p{L}'’\-]+(?:\s+[A-ZÄÖÜ][\p{L}'’\-]+){0,3})\s*[,;·:\-–—]*\s*(?:(?:tel(?:efon)?|phone|mobile|handy|natel)\.?\s*:?\s*)?(?=\+?\d)/iu,
    );
    const initialContactName = cleanContactDisplayNameV17_90L91(
      structuredName || nameMatch?.[1]?.trim() || "",
    );
    const contactName = isInvalidContactDisplayNameV17_90L113(
      initialContactName,
    )
      ? extractContactNameBeforePhoneV17_90L113(line, phone)
      : initialContactName;
    const contactParts = [contactName, phone];
    const contactContext = contactLine || line;
    if (/\bwhatsapp\b/i.test(contactContext)) contactParts.push("nur WhatsApp");
    else if (/\b(?:sms|text\s+message|kurznachricht)\b/i.test(contactContext)) {
      contactParts.push("nur SMS");
    }
    if (/\b(?:nicht\s+telefonisch|nicht\s+(?:im\s+büro\s+)?anrufen|kein\s+anruf|do\s+not\s+call|don['’]?t\s+call|no\s+calls?)\b/i.test(contactContext)) {
      contactParts.push("nicht telefonisch");
    }
    if (/\b(?:zuerst|vorher|vor\s+ankunft)\s+(?:kurz\s+)?anrufen\b/i.test(contactContext)) {
      contactParts.push("zuerst anrufen");
    }
    if (/\bnicht\s+einfach\s+(?:kommen|vorbeikommen)\b/i.test(contactContext)) {
      contactParts.push("nicht einfach kommen");
    }
    pushUnique(`Kontakt: ${contactParts.filter(Boolean).join(" · ")}`);
  }

  const appointmentLine = source.find((line) =>
    /\b(?:termin|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i.test(
      line,
    ) && /\b\d{1,2}(?::\d{2})?\b/.test(line),
  );
  if (appointmentLine) {
    const weekday = appointmentLine.match(
      /\b(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)\b/i,
    )?.[1];
    const dateRaw = appointmentLine.match(/\b\d{1,2}\.\d{1,2}\.?/)?.[0];
    const date = dateRaw ? `${dateRaw.replace(/\.$/, "")}.` : "";
    const times = appointmentLine.match(/\b\d{1,2}:\d{2}\b/g) || [];
    const appointmentParts = [weekday, date]
      .filter(Boolean)
      .join(" ");
    const timePart = times.length >= 2 ? `${times[0]}–${times[1]}` : times[0] || "";
    const notice = /\b(?:vorher|vor\s+ankunft|ankunft\s+vorher|genaue\s+zeit)\b/i.test(
      appointmentLine,
    )
      ? /\bwhatsapp\b/i.test(appointmentLine)
        ? "Ankunft vorher per WhatsApp mitteilen"
        : /\bsms\b/i.test(appointmentLine)
          ? "Ankunft vorher per SMS mitteilen"
          : "Ankunft vorher mitteilen"
      : "";
    pushUnique(
      `Termin: ${[appointmentParts, timePart, notice].filter(Boolean).join(" · ")}`,
    );
  }

  const accessLines = source.filter((line) => {
    const normalized = normalizeForMatch(line);
    const hasDirectAccessSignal =
      /\b(?:schluessel|schlussel|schlüssel|key|code|besucherausweis|zugang|badge|schluesselbox|schlusselbox|schlüsselbox)\b/.test(
        normalized,
      );
    const receptionCarriesAccess =
      /\bempfang\b/.test(normalized) &&
      /\b(?:schluessel|schlussel|schlüssel|key|code|badge|besucherausweis)\b/.test(
        normalized,
      );
    return hasDirectAccessSignal || receptionCarriesAccess;
  });
  if (accessLines.length > 0) {
    const normalizedAccessLines = uniqueOrderInfoLinesV17_66(
      accessLines.flatMap((line) =>
        line
          .replace(/^\s*zugang\s*:?\s*/i, "")
          .replace(/[.;]+$/g, "")
          .split(/\s+[·|]\s+/g)
          .map((part) => normalizeAccessDisplayLineV17_90L113(part))
          .filter(Boolean),
      ),
    );
    const accessKeyV17_90L84 = (line: string) =>
      normalizeForMatch(line)
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const dedupedAccessLines = normalizedAccessLines
      .slice()
      .sort((left, right) => right.length - left.length)
      .reduce<string[]>((result, line) => {
        const key = accessKeyV17_90L84(line);
        if (!key) return result;
        const alreadyCovered = result.some((existing) => {
          const existingKey = accessKeyV17_90L84(existing);
          return (
            existingKey === key ||
            (existingKey.length >= 8 &&
              key.length >= 8 &&
              (existingKey.includes(key) || key.includes(existingKey)))
          );
        });
        if (!alreadyCovered) result.push(line);
        return result;
      }, []);
    const badgeAtReception = dedupedAccessLines.some((line) =>
      /\bbadge\b/i.test(line) && /\bempfang\b/i.test(line),
    );
    const noCode = dedupedAccessLines.some((line) =>
      /\b(?:kein\s+code|code\s+gibt\s+es\s+keinen|ohne\s+code)\b/i.test(
        line,
      ),
    );
    const badgeTarget = dedupedAccessLines
      .map((line) => line.match(/\b([A-ZÄÖÜ][\p{L}'’\-]*raum)\b/u)?.[1] || "")
      .find(Boolean);
    const accessValue = badgeAtReception
      ? `${badgeTarget ? `${badgeTarget}: ` : ""}Badge beim Empfang${noCode ? ", kein Code" : ""}`
      : dedupedAccessLines.join(" · ");
    pushUnique(`Zugang: ${accessValue}`);
  }

  const senderLine = source.find((line) =>
    /\b(?:nicht\s+als\s+kunde\s+speichern|leite\w*\s+(?:das\s+)?nur\s+weiter|schickt\s+das\s+nur\s+weiter)\b/i.test(
      line,
    ),
  );
  if (senderLine) {
    const senderName = senderLine.match(
      /\b(?:ich\s+bin|je\s+suis|soy|eu\s+sou|sono|abssender\s*:?|absender\s*:?)\s+([A-ZÄÖÜ][\p{L}'’\-]+)/iu,
    )?.[1];
    const senderParts = [
      senderName ? `${senderName} leitet nur weiter` : "Leitet nur weiter",
      /nicht\s+als\s+kunde\s+speichern/i.test(senderLine)
        ? "nicht als Kunde speichern"
        : "",
    ].filter(Boolean);
    pushUnique(`Absender: ${senderParts.join(" · ")}`);
  }

  source.forEach((line) => {
    if (
      /\b(?:kontakt\s+vor\s+ort|vor\s+ort|whatsapp|sms|telefon|anrufen|anruf|termin|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|schlüssel|schluessel|code|besucherausweis|zugang|nicht\s+als\s+kunde\s+speichern|leite\w*\s+(?:das\s+)?nur\s+weiter|schickt\s+das\s+nur\s+weiter)\b/i.test(
        line,
      )
    ) {
      return;
    }
    pushUnique(`Hinweis: ${line.length > 150 ? `${line.slice(0, 147).trim()}…` : line}`);
  });

  return result.slice(0, 8);
};

const buildSpecialNotesSummaryTooltipV17_91 = (
  order: {
    specialNotes?: string | null;
    notes?: string | null;
    audioTranscript?: string | null;
    intakeSchemaVersion?: string | null;
    intakeSnapshot?: unknown;
  },
  parsedNotes: ReturnType<typeof splitSpecialNotes>,
) => {
  const summary = buildOrderInfoSummaryV17_65(order, parsedNotes);
  const compactPrimary = getCanonicalIntakeV2(order)
    ? summary.primary
    : compactImportantInfoLinesV17_90L73(summary.primary);
  return [
    summary.safety.length ? ["Gefahr / Achtung", ...summary.safety].join("\n") : "",
    compactPrimary.length ? ["Wichtige Informationen", ...compactPrimary].join("\n") : "",
    summary.additional.length ? ["Weitere Besonderheiten", ...summary.additional].join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n---\n");
};

const splitSpecialNotesSummaryTooltipV17_91 = (tooltip: string) => {
  const result: { safety: string[]; primary: string[]; hints: string[] } = {
    safety: [],
    primary: [],
    hints: [],
  };
  let section: "safety" | "primary" | "hints" | null = null;

  tooltip.split(/\n+/g).forEach((rawLine) => {
    const line = compactText(rawLine);
    if (!line || /^[-─—–_]{3,}$/.test(line)) return;
    if (/^Gefahr\s*\/\s*Achtung$/i.test(line)) {
      section = "safety";
      return;
    }
    if (/^(?:Wichtige Informationen|Ausgewählter Hinweis)$/i.test(line)) {
      section = "primary";
      return;
    }
    if (/^(?:Weitere Besonderheiten|Besonderheiten)$/i.test(line)) {
      section = "hints";
      return;
    }
    if (section === "safety") result.safety.push(line);
    if (section === "primary") result.primary.push(line);
    if (section === "hints") result.hints.push(line);
  });

  return result;
};

// V17.90L175: The red dog chip contains dog information only. Contact
// numbers/channels accidentally attached to a dog sentence stay in the
// communication chips and must not be repeated in the danger popover.
const dogTooltipSemanticKeyV17_90L176 = (value?: string | null) =>
  normalizeForMatch(value)
    .replace(
      /\b(?:ein|eine|einen|einem|einer|der|die|das|ist|sind|war|waren|befindet|befinden|sich|steht|stehen|sitzt|sitzen|liegt|liegen)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

const isBareDogTooltipLineV17_90L177 = (value?: string | null) =>
  /^(?:hund|hunde|dog|dogs|chien|chiens|cane|cani|perro|perros)[.!]?$/i.test(
    compactText(value),
  );

const sanitizeDogOnlyTooltipV17_90L175 = (value?: string | null) => {
  const rawLines = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|\s*[|]\s*/g)
    .map((line) =>
      compactText(
        line
          .replace(/^\s*\[(?:GEFAHR|WARNUNG|WARNHINWEIS|HINWEIS|INFO|NOTIZ)\]\s*/i, "")
          .replace(/^\s*Kontakt vor Ort\s*:\s*/i, "")
          .replace(/\s*[·|,-]\s*(?:Tel\.?|Telefon|SMS|WhatsApp|E-?Mail)\b[\s\S]*$/i, "")
          .replace(/\s+(?:Tel\.?|Telefon)\s*[:.]?\s*\+?\d[\d\s()./-]{6,}.*$/i, "")
          .replace(/\s+\+?\d[\d\s()./-]{6,}\s*(?:·|,|-)?\s*(?:nur\s+)?(?:SMS|WhatsApp|anrufen|Telefon).*$/i, ""),
      ),
    )
    .filter((line) => /\b(?:hund|dog|chien|cane|perro)\b/i.test(line));

  // V17.90L177: Ein isoliertes "Hund" ist nur ein Kategoriefragment. Sobald
  // eine konkrete Hundaussage vorhanden ist, darf dieses Fragment nicht als
  // zweiter Eintrag im Popover erscheinen.
  const descriptiveLines = rawLines.filter(
    (line) => !isBareDogTooltipLineV17_90L177(line),
  );
  const lines = descriptiveLines.length > 0 ? descriptiveLines : rawLines;

  const unique: string[] = [];
  for (const line of lines) {
    const key = dogTooltipSemanticKeyV17_90L176(line);
    if (!key) continue;
    const duplicateIndex = unique.findIndex((existing) => {
      const existingKey = dogTooltipSemanticKeyV17_90L176(existing);
      return (
        existingKey === key ||
        existingKey.includes(key) ||
        key.includes(existingKey)
      );
    });
    if (duplicateIndex >= 0) {
      if (line.length > unique[duplicateIndex].length) unique[duplicateIndex] = line;
      continue;
    }
    unique.push(line);
  }
  return unique.join("\n");
};

const getOperationalBadges = (
  order: Order,
  parsedNotes: ReturnType<typeof splitSpecialNotes>,
): ReviewBadge[] => {
  const badges: ReviewBadge[] = [];
  const canonicalSnapshotV2 = getCanonicalIntakeV2(order);
  if (canonicalSnapshotV2) {
    const info = canonicalOrderInfoForOrderV17_90L252(
      order,
      canonicalSnapshotV2,
    );
    const summaryTooltip = [
      info.safety.length ? ["Gefahr / Achtung", ...info.safety].join("\n") : "",
      info.primary.length ? ["Wichtige Informationen", ...info.primary].join("\n") : "",
      info.additional.length ? ["Weitere Besonderheiten", ...info.additional].join("\n") : "",
    ].filter(Boolean).join("\n---\n");
    if (summaryTooltip) {
      pushUniqueBadge(badges, {
        key: "special_notes_summary",
        label: "Info",
        className: "bg-blue-100 text-blue-700 border border-blue-300",
        tooltip: summaryTooltip,
        focusTarget: "specialNotes",
      });
    }
    canonicalLinesV2(canonicalSnapshotV2.roles.parking).forEach((line) => {
      pushUniqueBadge(badges, {
        key: "hint_parking",
        label: "Parken",
        className: "bg-blue-100 text-blue-700 border border-blue-300",
        tooltip: line,
        focusTarget: "specialNotes",
      });
    });
    canonicalLinesV2(canonicalSnapshotV2.roles.safety).forEach((line) => {
      const dog = /\b(?:hund|dog|chien|cane|perro)\b/i.test(line);
      pushUniqueBadge(badges, {
        key: dog ? "danger_dog" : "danger_warning",
        label: dog ? "Hund" : "Achtung",
        className: "bg-red-100 text-red-700 border border-red-300",
        icon: true,
        tooltip: line,
        focusTarget: "specialNotes",
      });
    });
    // V17.90L215: Alle versiegelten Zugangsangaben bilden genau einen
    // Zugang-/Schlüsselchip. Dadurch stehen Schlüssel, Tor-/Türcode, PIN und
    // Badge gemeinsam im Hover/Popover statt als getrennte oder allgemeine
    // Hinweise aufzutauchen.
    const canonicalAccessLinesV17_90L215 = canonicalLinesV2(
      canonicalSnapshotV2.roles.access,
    );
    if (canonicalAccessLinesV17_90L215.length > 0) {
      const hasExplicitAccessCredentialV17_90L215 =
        canonicalAccessLinesV17_90L215.some((line) =>
          /\b(?:zugang|zutritt|code|pin|badge|tor|tür|tuer|schlüsselbox|schluesselbox|briefkasten)\b/i.test(
            line,
          ),
        );
      pushUniqueBadge(badges, {
        key: "canonical_access",
        label: hasExplicitAccessCredentialV17_90L215 ? "Zugang" : "Schlüssel",
        className:
          "bg-amber-100 text-amber-700 border border-amber-300",
        tooltip: canonicalAccessLinesV17_90L215.join("\n"),
        focusTarget: "specialNotes",
      });
    }
    const suppressedReviewDisplayTextsV17_90L280 =
      activeRecognitionDisplayTextsV17_90L280(order);
    canonicalLinesV2([
      ...canonicalSnapshotV2.roles.other,
      ...canonicalSnapshotV2.roles.ordinary,
    ])
      .filter(
        (line) =>
          !suppressedReviewDisplayTextsV17_90L280.some((reviewText) =>
            orderInfoLinesEquivalentV17_66(line, reviewText),
          ),
      )
      .forEach((line) => {
      const kind = getSemanticBadgeKind(line);
      const label = kind ? badgeLabelByKind[kind] : "";
      if (!kind || !label || kind === "warning" || kind === "appointment" || kind === "parking") return;
      pushUniqueBadge(badges, {
        key: `canonical_${kind}`,
        label,
        className: isPositiveSemanticHint(line)
          ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
          : "bg-amber-100 text-amber-700 border border-amber-300",
        tooltip: line,
        focusTarget: "specialNotes",
      });
    });
    return sortReviewBadges(badges);
  }
  if (isIntakeV2Order(order)) {
    return [{
      key: "canonical_intake_v2_invalid",
      label: "Intake prüfen",
      className: "bg-red-100 text-red-700 border border-red-400",
      icon: true,
      tooltip: "Der versiegelte Intake-Snapshot ist ungültig. Rohtext-Fallbacks wurden blockiert.",
      focusTarget: "specialNotes",
    }];
  }
  const orderBadgeContext = [
    order.specialNotes,
    order.notes,
    order.audioTranscript,
  ]
    .map((part) => compactText(part))
    .filter(Boolean)
    .join(" | ");

  const redWarningClass = "bg-red-100 text-red-700 border border-red-300";
  const amberHintClass = "bg-amber-100 text-amber-700 border border-amber-300";
  const greenInfoClass =
    "bg-emerald-100 text-emerald-700 border border-emerald-300";

  const addDanger = (key: string, label: string, tooltip?: string) =>
    pushUniqueBadge(badges, {
      key: label === "Hund" ? "danger_dog" : "danger_warning",
      label: label === "Hund" ? "Hund" : "Achtung",
      className: redWarningClass,
      icon: true,
      tooltip: label === "Hund" ? sanitizeDogOnlyTooltipV17_90L175(tooltip) : tooltip,
      focusTarget: "specialNotes",
    });

  const addHint = (
    key: string,
    label: string,
    className = amberHintClass,
    tooltip?: string,
  ) =>
    pushUniqueBadge(badges, {
      key,
      label,
      className,
      tooltip,
      focusTarget: "specialNotes",
    });

  const specialNotesSummaryTooltip = buildSpecialNotesSummaryTooltipV17_91(order, parsedNotes);
  if (specialNotesSummaryTooltip) {
    pushUniqueBadge(badges, {
      key: "special_notes_summary",
      label: "Info",
      className: "bg-blue-100 text-blue-700 border border-blue-300",
      tooltip: specialNotesSummaryTooltip,
      focusTarget: "specialNotes",
    });
  }

  // Show the blue parking chip only when the source contains parking information.
  const unifiedParkingBadge = getUnifiedParkingBadgeV17_90L99([
    ...parsedNotes.safetyWarnings,
    ...parsedNotes.jobHints,
    order.specialNotes,
    order.notes,
    order.audioTranscript,
  ]);
  if (unifiedParkingBadge) {
    addHint(
      "hint_parking",
      unifiedParkingBadge.label,
      unifiedParkingBadge.className,
      unifiedParkingBadge.tooltip,
    );
  }

  parsedNotes.safetyWarnings.forEach((line) => {
    const kind = getSemanticBadgeKind(line);
    if (kind === "parking" || getParkingSignal(line).hasParking) return;
    if (kind === "care" || kind === "ppe") {
      const label = badgeLabelByKind[kind];
      addHint(
        `hint_${kind}_${normalizeForMatch(line).slice(0, 48)}`,
        label,
        amberHintClass,
        formatOperationalHintTooltip(
          order,
          kind,
          parsedNotes,
          line,
          orderBadgeContext,
        ),
      );
      return;
    }

    const label = dangerBadgeLabel(line);
    addDanger(`danger_${normalizeForMatch(label)}`, label, line);
  });


  parsedNotes.jobHints.forEach((line) => {
    if (isNonActionableSemanticHint(line, orderBadgeContext)) return;

    const kind = getSemanticBadgeKind(line);
    if (!kind || kind === "warning" || kind === "appointment") return;

    if (kind === "parking" || getParkingSignal(line).hasParking) return;

    const label = badgeLabelByKind[kind];
    if (!label) return;

    if (kind === "dog") {
      addDanger(
        `danger_${normalizeForMatch(label)}`,
        label,
        formatOperationalHintTooltip(
          order,
          kind,
          parsedNotes,
          line,
          orderBadgeContext,
        ),
      );
      return;
    }

    // If a safety warning already created a red danger chip, do not add the
    // same semantic hint again in yellow. Example: "Achtung Hund" must show
    // one Hund chip, not red Hund + yellow Hund.
    if (
      badges.some(
        (badge) => normalizeForMatch(badge.label) === normalizeForMatch(label),
      )
    ) {
      return;
    }

    addHint(
      `hint_${kind}`,
      label,
      isPositiveSemanticHint(line) ? greenInfoClass : amberHintClass,
      formatOperationalHintTooltip(
        order,
        kind,
        parsedNotes,
        line,
        orderBadgeContext,
      ),
    );
  });


  // Unknown operational notes stay inside the order detail. The card only shows short, useful chips.
  // CARD_BADGE_SORT_AND_LIMIT_V15
  const sortedBadges = sortReviewBadges(badges);
  if (sortedBadges.length <= 9) return sortedBadges;

  const visible = sortedBadges.slice(0, 8);
  visible.push({
    key: "more_operational_badges",
    label: `+${sortedBadges.length - 8}`,
    className: "bg-muted text-muted-foreground border border-border",
  });
  return visible;
};

const AMOUNT_REVIEW_BADGE_KEYS = new Set([
  "price_quantity",
  "unit_conflict",
  "currency_review",
  "price_contradiction",
  "canonical_mutation",
  "intake_failure",
  "recognition_review",
  "order_review_summary",
  "price_deviation",
  "catalog_missing",
  "catalog_review_combined",
  "service_review_summary",
]);

const PRICE_AMOUNT_REVIEW_BADGE_KEYS = new Set([
  "price_quantity",
  "unit_conflict",
  "price_contradiction",
  "canonical_mutation",
  "intake_failure",
  "price_deviation",
]);

const isAmountReviewBadge = (badge: ReviewBadge) =>
  AMOUNT_REVIEW_BADGE_KEYS.has(badge.key);

const isRedAmountReviewBadgeV17_90L165 = (badge: ReviewBadge) =>
  isAmountReviewBadge(badge) &&
  /(?:^|\s)(?:bg|text|border)-red-/.test(badge.className || "");

const compactAmountReviewCountV17_90L165 = (badge: ReviewBadge) => {
  const explicitCount = Number(
    String(badge.label || "").match(/(\d+)\s*$/)?.[1] || 0,
  );
  if (explicitCount > 0) return explicitCount;
  if (isRedAmountReviewBadgeV17_90L165(badge)) {
    return concreteRedReviewPositionCountV17_90L242([badge]);
  }
  return 1;
};

const findCatalogServiceForName = (
  services: ServiceDef[],
  serviceName?: string | null,
) => {
  const key = normalizeForMatch(canonicalServiceNameForOrderItem(serviceName));
  if (!key) return null;

  return (
    services.find(
      (service) =>
        normalizeForMatch(canonicalServiceNameForOrderItem(service.name)) ===
        key,
    ) || null
  );
};

const normalizePriceUnitForCompare = (value?: string | null) => {
  const unit = normalizeForMatch(value);
  if (!unit) return "";
  if (["stueck", "stück", "stk", "piece", "pieces"].includes(unit))
    return "piece";
  if (["quadratmeter", "qm", "m2", "m²", "sqm"].includes(unit))
    return "square_meter";
  if (["kubikmeter", "cbm", "m3", "m³"].includes(unit)) return "cubic_meter";
  if (["stunde", "stunden", "std", "h", "hour", "hours"].includes(unit))
    return "hour";
  if (["tag", "tage", "day", "days"].includes(unit)) return "day";
  if (["meter", "laufmeter", "lfm", "m"].includes(unit)) return "meter";
  if (["kilogramm", "kg"].includes(unit)) return "kilogram";
  if (["tonne", "tonnen"].includes(unit)) return "ton";
  if (["liter", "ltr", "l"].includes(unit)) return "liter";
  if (["pauschal", "pauschale", "fixpreis", "festpreis", "flat"].includes(unit))
    return "flat";
  return unit;
};

type RecognitionReviewPayloadV17_90L69 = {
  kind?: string;
  findingId?: string;
  serviceName?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  sourceText?: string;
  relatedRoleText?: string | null;
  reason?: string | null;
};

const RECOGNITION_REVIEW_DETAIL_PREFIX_V17_90L69 =
  "intake_risk:recognition_review:";
const RECOGNITION_REVIEW_GENERIC_REASON_V17_90L69 =
  "intake_risk:priced_service_line_missing_or_mismatched";

const isRecognitionReviewReasonV17_90L69 = (reason?: string | null) => {
  const value = String(reason || "").trim();
  return (
    value === RECOGNITION_REVIEW_GENERIC_REASON_V17_90L69 ||
    value.startsWith(RECOGNITION_REVIEW_DETAIL_PREFIX_V17_90L69)
  );
};

const parseRecognitionReviewReasonV17_90L69 = (
  reason?: string | null,
): RecognitionReviewPayloadV17_90L69 | null => {
  const value = String(reason || "").trim();
  if (!value.startsWith(RECOGNITION_REVIEW_DETAIL_PREFIX_V17_90L69))
    return null;

  try {
    const encoded = value.slice(
      RECOGNITION_REVIEW_DETAIL_PREFIX_V17_90L69.length,
    );
    const payload = JSON.parse(decodeURIComponent(encoded));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
};

const getRecognitionReviewDetailsV17_90L69 = (order?:
  | Pick<Order, "reviewReasons" | "intakeSchemaVersion" | "intakeSnapshot">
  | null) => {
  // V17.90L252: Intake V2 may contain separate read-only recognition findings.
  // They are not canonical items and remain active only while the mutable
  // reviewReason exists. This preserves the first-AI-only item boundary.
  const byKey = new Map<string, RecognitionReviewPayloadV17_90L69>();
  for (const detail of (order?.reviewReasons || [])
    .map(parseRecognitionReviewReasonV17_90L69)
    .filter(
      (value): value is RecognitionReviewPayloadV17_90L69 => Boolean(value),
    )) {
    const key =
      compactText(detail.findingId) ||
      [
        normalizeForMatch(detail.serviceName),
        Number(detail.quantity || 0).toFixed(4),
        normalizePriceUnitForCompare(detail.unit),
        Number(detail.unitPrice || 0).toFixed(4),
        normalizeForMatch(detail.sourceText),
      ].join("|");
    // The server orders original evidence before translated evidence. Keep the
    // first occurrence defensively so a later duplicate can never replace the
    // original source shown to the user.
    if (!byKey.has(key)) byKey.set(key, detail);
  }
  return Array.from(byKey.values());
};

const hasRecognitionReviewV17_90L69 = (
  order?: Pick<
    Order,
    "reviewReasons" | "items" | "intakeSchemaVersion" | "intakeSnapshot"
  > | null,
) => {
  const details = getRecognitionReviewDetailsV17_90L69(order);
  if (details.length > 0) {
    return getActiveRecognitionReviewDetailsV17_90L80(order).length > 0;
  }
  return Boolean(
    order?.reviewReasons?.some(
      (reason) =>
        String(reason || "").trim() ===
        RECOGNITION_REVIEW_GENERIC_REASON_V17_90L69,
    ),
  );
};

const recognitionReviewDetailKeyV17_90L70 = (
  detail?: RecognitionReviewPayloadV17_90L69 | null,
) =>
  compactText(detail?.findingId) ||
  [
    normalizeForMatch(detail?.serviceName),
    Number(detail?.quantity || 0).toFixed(4),
    normalizePriceUnitForCompare(detail?.unit),
    Number(detail?.unitPrice || 0).toFixed(4),
    normalizeForMatch(detail?.sourceText),
  ].join("|");

const recognitionReviewReasonKeyV17_90L70 = (reason?: string | null) => {
  const value = String(reason || "").trim();
  const detail = parseRecognitionReviewReasonV17_90L69(value);
  if (detail) return recognitionReviewDetailKeyV17_90L70(detail);
  if (value === RECOGNITION_REVIEW_GENERIC_REASON_V17_90L69) {
    return RECOGNITION_REVIEW_GENERIC_REASON_V17_90L69;
  }
  return "";
};

const formatRecognitionReviewLineV17_90L69 = (
  detail: RecognitionReviewPayloadV17_90L69,
) => {
  const serviceName =
    canonicalServiceNameForOrderItem(detail.serviceName) ||
    compactText(detail.serviceName) ||
    "Mögliche Leistung";
  const quantity = Number(detail.quantity || 0);
  const unit = compactText(detail.unit);
  const unitPrice = Number(detail.unitPrice || 0);
  const amount =
    detail.kind === "invalid_item"
      ? "Leistungszuordnung prüfen"
      : detail.kind === "open_price"
        ? "Preis offen"
        : quantity > 0 && unitPrice > 0
          ? `${formatMergedNumberString(quantity)} ${unit || "Einheit"} à CHF ${unitPrice.toFixed(2)}`
          : "Werte unklar";
  return `• ${serviceName} — ${amount}`;
};

const formatRecognitionReviewTooltipV17_90L69 = (order: Order) => {
  const details = getActiveRecognitionReviewDetailsV17_90L80(order);
  const lines = ["Erkennung prüfen"];

  if (details.length > 0) {
    lines.push(...details.slice(0, 8).map(formatRecognitionReviewLineV17_90L69));
  } else {
    lines.push("• Mögliche fehlende oder falsch zugeordnete Leistung.");
  }

  lines.push("Auftrag öffnen und Vorschlag übernehmen oder verwerfen.");
  return lines.join("\n");
};

const recognitionEvidenceMentionsUnitV17_90L80 = (
  value: string | null | undefined,
  unit: string | null | undefined,
) => {
  const text = normalizeForMatch(value);
  const normalizedUnit = normalizePriceUnitForCompare(unit);
  if (!text || !normalizedUnit) return false;

  const patterns: Record<string, RegExp> = {
    piece: /\b(?:stueck|stk|pcs?|pieces?|pi[eè]ces?|pezzi)\b/i,
    meter: /\b(?:meter|metre|metri|m)\b/i,
    square_meter: /\b(?:m2|m²|qm|quadratmeter|square meter|metres carres)\b/i,
    hour: /\b(?:stunde|stunden|std|hour|hours|heure|heures|ora|ore)\b/i,
    flat: /\b(?:pauschal|pauschale|forfait|flat)\b/i,
    day: /\b(?:tag|tage|day|days|jour|jours)\b/i,
  };
  return Boolean(patterns[normalizedUnit]?.test(text));
};

const recognitionReviewDetailMatchesItemV17_90L69 = (
  detail: RecognitionReviewPayloadV17_90L69,
  item: {
    serviceName: string;
    quantity: string | number;
    unit: string;
    unitPrice: string | number;
    description?: string | null;
    sourceDescription?: string | null;
  },
) => {
  const expectedName = normalizeForMatch(
    canonicalServiceNameForOrderItem(detail.serviceName),
  );
  const actualName = normalizeForMatch(
    canonicalServiceNameForOrderItem(item.serviceName),
  );
  const sameName = Boolean(
    expectedName &&
      actualName &&
      (expectedName === actualName ||
        expectedName.includes(actualName) ||
        actualName.includes(expectedName)),
  );
  const expectedUnit = normalizePriceUnitForCompare(detail.unit);
  const actualUnit = normalizePriceUnitForCompare(item.unit);
  const sameUnit = expectedUnit === actualUnit;
  const evidenceSupportsActualUnit = recognitionEvidenceMentionsUnitV17_90L80(
    [detail.sourceText, item.description, item.sourceDescription]
      .filter(Boolean)
      .join(" "),
    item.unit,
  );
  const sameQuantity =
    Math.abs(Number(detail.quantity || 0) - Number(item.quantity || 0)) <
    0.001;
  const samePrice =
    Math.abs(Number(detail.unitPrice || 0) - Number(item.unitPrice || 0)) <
    0.01;
  const expectedEvidence = normalizeForMatch(detail.sourceText);
  const actualEvidence = normalizeForMatch(
    [item.description, item.sourceDescription].filter(Boolean).join(" "),
  );
  const sameEvidence = Boolean(
    expectedEvidence &&
      actualEvidence &&
      (expectedEvidence === actualEvidence ||
        expectedEvidence.includes(actualEvidence) ||
        actualEvidence.includes(expectedEvidence)),
  );
  return (
    sameName &&
    (sameUnit || evidenceSupportsActualUnit) &&
    sameQuantity &&
    samePrice &&
    (detail.kind !== "missing_work" || sameEvidence)
  );
};

const getActiveRecognitionReviewDetailsV17_90L80 = (
  order?: Pick<
    Order,
    "reviewReasons" | "items" | "intakeSchemaVersion" | "intakeSnapshot"
  > | null,
) =>
  getRecognitionReviewDetailsV17_90L69(order).filter((detail) => {
    // V17.90L252: A finding about an existing first-AI row is a separate
    // control record. The row itself must never auto-resolve that finding.
    if (detail.kind && detail.kind !== "missing_work") return true;
    return !(order?.items || []).some((item) =>
      recognitionReviewDetailMatchesItemV17_90L69(detail, item),
    );
  });

const areRecognitionReviewDetailsResolvedV17_90L69 = (
  order: Pick<Order, "reviewReasons"> | null | undefined,
  items: Array<Pick<FormItem, "serviceName" | "quantity" | "unit" | "unitPrice">>,
) => {
  const details = getRecognitionReviewDetailsV17_90L69(order);
  return (
    details.length > 0 &&
    details.every((detail) =>
      items.some((item) =>
        recognitionReviewDetailMatchesItemV17_90L69(detail, item),
      ),
    )
  );
};

const isInternalReviewServiceName = (value?: string | null) => {
  const key = normalizeForMatch(value);
  if (!key) return true;
  return new Set([
    "leistung pruefen",
    "leistung prufen",
    "pruefen",
    "prufen",
    "unklare leistung",
    "bitte pruefen",
    "bitte prufen",
    "einheit pruefen",
    "einheit prufen",
    "betrag pruefen",
    "betrag prufen",
  ]).has(key);
};

// V17.90L253: A read-only recognition finding may create a mutable review row
// only after the user explicitly presses Übernehmen. Prefill that row from
// the already stored finding evidence. No parser, validator or UI heuristic
// invents, translates or rewrites a service name here.
const recognitionReviewTakeoverTextV17_90L253 = (
  detail?: RecognitionReviewPayloadV17_90L69 | null,
) => {
  const relatedRoleText = compactText(detail?.relatedRoleText);
  if (relatedRoleText && !isInternalReviewServiceName(relatedRoleText)) {
    return relatedRoleText;
  }

  const sourceText = compactText(detail?.sourceText);
  if (sourceText && !isInternalReviewServiceName(sourceText)) {
    return sourceText;
  }

  const explicitServiceName = compactText(detail?.serviceName);
  if (
    explicitServiceName &&
    !isInternalReviewServiceName(explicitServiceName)
  ) {
    return explicitServiceName;
  }

  return "Zusätzliche Arbeit prüfen";
};

const recognitionReviewHasSeparateDisplayTextV17_90L253 = (
  detail?: RecognitionReviewPayloadV17_90L69 | null,
) => {
  const displayText = recognitionReviewTakeoverTextV17_90L253(detail);
  const sourceText = compactText(detail?.sourceText);
  return Boolean(
    displayText &&
      sourceText &&
      normalizeForMatch(displayText) !== normalizeForMatch(sourceText),
  );
};

const compactRecognitionReviewSourceV17_90L262 = (
  value?: string | null,
  maxLength = 96,
) => {
  const text = compactText(value);
  if (text.length <= maxLength) return text;

  const prefix = text.slice(0, maxLength);
  const lastSpace = prefix.lastIndexOf(" ");
  const cutAt = lastSpace >= Math.floor(maxLength * 0.7) ? lastSpace : maxLength;
  return `${prefix.slice(0, cutAt).trim()}…`;
};

// V17.90j2: Top-level helper, weil der Editor denselben Prüfzustand braucht
// wie die Karten-Badges. Das sind Smartflow-interne Review-Platzhalter,
// keine Service-Wortliste und keine fachliche Service-Erkennung.
const isUnitMissingReviewText = (value?: string | null) => {
  const key = normalizeForMatch(value);
  if (!key) return false;
  return (
    key === "pruefen" ||
    key === "prufen" ||
    key === "einheit pruefen" ||
    key === "einheit prufen" ||
    key.includes("einheit fehlt") ||
    key.includes("einheit unklar") ||
    key.includes("einheit offen") ||
    key.includes("unit missing") ||
    key.includes("unit unknown") ||
    key.includes("unit unclear") ||
    key.includes("unit review")
  );
};

// V17.90j: Diese Werte sind Smartflow-interne Prüfzustände, keine
// Leistungs-Wortliste. Sie dürfen im Editor nicht wie echte Leistungen wirken
// und sollen beim Bearbeiten nicht erst manuell gelöscht werden müssen.
const getEditableServiceNameValue = (value?: string | null) =>
  isInternalReviewServiceName(value) ? "" : String(value || "");

const hasUnitMismatchReviewForService = (
  reviewReasons: string[] | null | undefined,
  serviceName?: string | null,
) => {
  const key = normalizeForMatch(serviceName);
  if (!key) return false;

  return (
    reviewReasons?.some((reason) => {
      if (!reason.startsWith("unit_mismatch:")) return false;
      const [, reasonService] = reason.split(":");
      return normalizeForMatch(reasonService) === key;
    }) ?? false
  );
};

type CurrencyMismatchDetail = {
  serviceName: string;
  textCurrency: string;
  orderCurrency: string;
  reason: string;
};

const parseCurrencyMismatchReviewReason = (
  reason?: string | null,
): CurrencyMismatchDetail | null => {
  const raw = String(reason || "").trim();
  if (!raw) return null;

  const parts = raw.split(":").map((part) => compactText(part));
  const kind = parts[0] || "";

  if (kind === "item_currency_mismatch" && parts.length >= 4) {
    return {
      serviceName: canonicalServiceNameForOrderItem(parts[1] || ""),
      textCurrency: (parts[2] || "UNKNOWN").toUpperCase(),
      orderCurrency: (parts[3] || "UNKNOWN").toUpperCase(),
      reason: raw,
    };
  }

  if (kind === "currency_conflict_item" && parts.length >= 2) {
    return {
      serviceName: canonicalServiceNameForOrderItem(parts[1] || ""),
      textCurrency: (parts[2] || "UNKNOWN").toUpperCase(),
      orderCurrency: (parts[3] || "UNKNOWN").toUpperCase(),
      reason: raw,
    };
  }

  return null;
};

const getCurrencyMismatchReviewDetails = (
  reviewReasons?: string[] | null,
): CurrencyMismatchDetail[] => {
  const seen = new Set<string>();
  const details: CurrencyMismatchDetail[] = [];

  (reviewReasons || []).forEach((reason) => {
    const detail = parseCurrencyMismatchReviewReason(reason);
    if (!detail?.serviceName) return;

    const key = [
      normalizeForMatch(detail.serviceName),
      detail.textCurrency,
      detail.orderCurrency,
    ].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    details.push(detail);
  });

  return details;
};

const getActiveCurrencyMismatchReviewDetailsV17_90L78 = (
  order: Pick<Order, "items"> | null | undefined,
  reviewReasons?: string[] | null,
): CurrencyMismatchDetail[] => {
  const items = order?.items || [];
  return getCurrencyMismatchReviewDetails(reviewReasons).filter((detail) => {
    const detailKey = normalizeForMatch(
      canonicalServiceNameForOrderItem(detail.serviceName),
    );
    if (!detailKey) return false;

    const matchingItem = items.find(
      (item) =>
        normalizeForMatch(
          canonicalServiceNameForOrderItem(item.serviceName),
        ) === detailKey,
    );
    if (!matchingItem) return false;

    const serviceKey = normalizeForMatch(matchingItem.serviceName);
    const unitKey = normalizeForMatch(matchingItem.unit);
    const serviceStillOpen =
      !serviceKey ||
      serviceKey === "leistung pruefen" ||
      serviceKey === "leistung prufen" ||
      serviceKey.includes("leistung suchen") ||
      serviceKey.includes("eingeben");
    const unitStillOpen =
      !unitKey ||
      unitKey === "pruefen" ||
      unitKey === "prufen" ||
      unitKey === "einheit pruefen" ||
      unitKey === "einheit prufen";

    const itemCurrency = String(
      matchingItem.detectedCurrency || matchingItem.currency || "",
    )
      .trim()
      .toUpperCase();
    const reviewReason = String(matchingItem.reviewReason || "");
    const hasStoredCurrencyMismatch =
      reviewReason.startsWith("item_currency_mismatch:") ||
      reviewReason.startsWith("currency_conflict_item:");
    const currencyStillDiffers =
      Boolean(itemCurrency) &&
      itemCurrency !== String(detail.orderCurrency || "").toUpperCase();
    const pricedButBlocked =
      Number(matchingItem.unitPrice || 0) > 0 &&
      Number(matchingItem.totalPrice || 0) <= 0;

    return (
      hasStoredCurrencyMismatch ||
      currencyStillDiffers ||
      pricedButBlocked ||
      Number(matchingItem.unitPrice || 0) <= 0 ||
      Number(matchingItem.quantity || 0) <= 0 ||
      serviceStillOpen ||
      unitStillOpen
    );
  });
};

const hasItemLevelCurrencyReviewReasons = (reviewReasons?: string[] | null) =>
  getCurrencyMismatchReviewDetails(reviewReasons).length > 0;

const hasAnyCurrencyReviewReason = (reviewReasons?: string[] | null) =>
  (reviewReasons || []).some(
    (reason) =>
      String(reason || "").startsWith("currency_") ||
      String(reason || "").startsWith("item_currency_mismatch:") ||
      String(reason || "").startsWith("currency_conflict_item:"),
  );

const hasCurrencyMismatchReviewForService = (
  reviewReasons?: string[] | null,
  serviceName?: string | null,
) => {
  const serviceKey = normalizeForMatch(
    canonicalServiceNameForOrderItem(serviceName),
  );
  if (!serviceKey) return false;

  return getCurrencyMismatchReviewDetails(reviewReasons).some(
    (detail) =>
      normalizeForMatch(
        canonicalServiceNameForOrderItem(detail.serviceName),
      ) === serviceKey,
  );
};

const hasGlobalCurrencyReviewWithoutItemDetails = (
  reviewReasons?: string[] | null,
) =>
  hasAnyCurrencyReviewReason(reviewReasons) &&
  !hasItemLevelCurrencyReviewReasons(reviewReasons);

type CurrencyAmountEvidenceV17_90L37 = {
  currency: "CHF" | "EUR";
  amount: number;
  evidence: string;
};

type ForeignCurrencyAmountV17_90L36D = CurrencyAmountEvidenceV17_90L37;

// V17.90L37: Betragsbelege werden strukturell pro Währungsanker getrennt.
// Dadurch wird aus einem chaotischen Einzeiler mit mehreren Leistungen die
// letzte Position "Travel cost EUR 35" als eigener, bearbeitbarer Beleg statt
// als unsichtbarer globaler Blocker.
const extractCurrencyAmountEvidenceV17_90L37 = (
  value: string | null | undefined,
): CurrencyAmountEvidenceV17_90L37[] => {
  const source = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!source.trim()) return [];

  const parsed: CurrencyAmountEvidenceV17_90L37[] = [];
  const logicalLines = source
    .split(/\n+/g)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const amountAnchor =
    /(?:\b(CHF|EUR)\b|(€))\s*([0-9]+(?:[.,][0-9]{1,2})?)|([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:\b(CHF|EUR)\b|(€))/gi;

  for (const line of logicalLines) {
    const anchors: Array<{
      start: number;
      end: number;
      currency: "CHF" | "EUR";
      amount: number;
    }> = [];
    amountAnchor.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = amountAnchor.exec(line)) !== null) {
      const leading = Boolean(match[3]);
      const currencyToken = leading ? match[1] || match[2] : match[5] || match[6];
      const amountToken = leading ? match[3] : match[4];
      const amount = Number(String(amountToken || "").replace(",", "."));
      if (!Number.isFinite(amount) || amount <= 0) continue;
      anchors.push({
        start: match.index,
        end: match.index + match[0].length,
        currency:
          String(currencyToken || "").toUpperCase() === "CHF" ? "CHF" : "EUR",
        amount,
      });
    }

    if (anchors.length === 0) continue;
    let segmentStart = 0;
    for (const anchor of anchors) {
      const evidence = line
        .slice(segmentStart, anchor.end)
        .replace(/^\s*(?:[,.;:|+]|und\b|and\b|et\b|e\b)+\s*/i, "")
        .replace(/\s+/g, " ")
        .trim();
      segmentStart = anchor.end;
      parsed.push({
        currency: anchor.currency,
        amount: anchor.amount,
        evidence: evidence || line.slice(anchor.start, anchor.end),
      });
    }
  }

  const bestByKey = new Map<string, CurrencyAmountEvidenceV17_90L37>();
  parsed.forEach((entry) => {
    const evidenceKey = normalizeForMatch(entry.evidence);
    const key = `${entry.currency}|${entry.amount.toFixed(2)}|${evidenceKey}`;
    const previous = bestByKey.get(key);
    if (!previous || entry.evidence.length < previous.evidence.length) {
      bestByKey.set(key, entry);
    }
  });
  return Array.from(bestByKey.values());
};

const extractForeignCurrencyAmountsV17_90L36D = (
  value: string | null | undefined,
  orderCurrency: string | null | undefined,
): ForeignCurrencyAmountV17_90L36D[] => {
  const normalizedOrderCurrency =
    String(orderCurrency || "CHF").toUpperCase() === "EUR" ? "EUR" : "CHF";
  return extractCurrencyAmountEvidenceV17_90L37(value).filter(
    (entry) => entry.currency !== normalizedOrderCurrency,
  );
};

const orderCurrencyEvidenceSourceV17_90L37 = (order?: Order | null) =>
  Array.from(
    new Set(
      [
        order?.notes,
        order?.audioTranscript,
        order?.description,
        order?.specialNotes,
        ...(order?.items || []).flatMap((item) => [
          item?.description || "",
          item?.serviceName || "",
        ]),
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ).join("\n");

// Alte Aufträge können item_currency_mismatch an korrekte CHF-Positionen
// angehängt haben, weil deren Beschreibung den kompletten Kundentext enthielt.
// Eine positive Position gilt nur dann als falsch zugeordnet, wenn ihr eigener
// Preis im Auftragswährung-Beleg vorkommt und die Fremdwährungsposition einen
// anderen Betrag besitzt. Der Fremdbetrag wird anschliessend als eigene
// Prüfposition sichtbar gemacht.
const effectiveOrderReviewReasonsV17_90L37 = (
  order?: Order | null,
): string[] => {
  const originalReasons = Array.isArray(order?.reviewReasons)
    ? order!.reviewReasons!.filter(Boolean)
    : [];
  if (!order || originalReasons.length === 0) return originalReasons;

  const orderCurrency = order.currency === "EUR" ? "EUR" : "CHF";
  const evidence = extractCurrencyAmountEvidenceV17_90L37(
    orderCurrencyEvidenceSourceV17_90L37(order),
  );
  const foreignEvidence = evidence.filter(
    (entry) => entry.currency !== orderCurrency,
  );
  const staleReasons = new Set<string>();

  getCurrencyMismatchReviewDetails(originalReasons).forEach((detail) => {
    const serviceKey = normalizeForMatch(
      canonicalServiceNameForOrderItem(detail.serviceName),
    );
    const item = (order.items || []).find(
      (candidate) =>
        normalizeForMatch(
          canonicalServiceNameForOrderItem(candidate.serviceName),
        ) === serviceKey,
    );
    const price = Number(item?.unitPrice || 0);
    const quantity = Number(item?.quantity || 0);
    if (!item || price <= 0 || quantity <= 0) return;
    if (detail.textCurrency === orderCurrency) return;

    const itemEvidence = extractCurrencyAmountEvidenceV17_90L37(
      [item.description, item.serviceName].filter(Boolean).join("\n"),
    );
    const hasOwnOrderCurrencyPrice = itemEvidence.some(
      (entry) =>
        entry.currency === orderCurrency && Math.abs(entry.amount - price) < 0.01,
    );
    const hasDifferentForeignAmount = foreignEvidence.some(
      (entry) =>
        entry.currency === detail.textCurrency &&
        Math.abs(entry.amount - price) >= 0.01,
    );

    if (hasOwnOrderCurrencyPrice && hasDifferentForeignAmount) {
      staleReasons.add(detail.reason);
    }
  });

  const next = originalReasons.filter((reason) => !staleReasons.has(reason));
  if (staleReasons.size > 0 && foreignEvidence.length > 0) {
    next.push("currency_conflict", "currency_review");
  }
  return Array.from(new Set(next));
};

const findUnitMissingInTextReviewForService = (
  reviewReasons: string[] | null | undefined,
  serviceName?: string | null,
) => {
  const key = normalizeForMatch(serviceName);
  if (!key) return "";

  return (
    reviewReasons?.find((reason) => {
      if (!reason.startsWith("unit_missing_in_text:")) return false;
      const [, reasonService] = reason.split(":");
      return normalizeForMatch(reasonService) === key;
    }) || ""
  );
};


const reviewServiceNamesMatchV17_90L241 = (
  leftValue?: string | null,
  rightValue?: string | null,
) => {
  const left = normalizeForMatch(
    canonicalServiceNameForOrderItem(leftValue || ""),
  );
  const right = normalizeForMatch(
    canonicalServiceNameForOrderItem(rightValue || ""),
  );
  if (!left || !right) return false;
  if (left === right) return true;

  const leftTokens = left.split(/\s+/g).filter((token) => token.length >= 2);
  const rightTokens = right.split(/\s+/g).filter((token) => token.length >= 2);
  const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
  const longer = leftTokens.length <= rightTokens.length ? rightTokens : leftTokens;
  if (shorter.length < 3) return false;

  const longerSet = new Set(longer);
  const coverage = shorter.filter((token) => longerSet.has(token)).length;
  return coverage === shorter.length && shorter.length / longer.length >= 0.65;
};

const findCanonicalMutationReviewForServiceV17_90L241 = (
  reviewReasons: string[] | null | undefined,
  serviceName?: string | null,
) => {
  const key = normalizeForMatch(
    canonicalServiceNameForOrderItem(serviceName || ""),
  );
  if (!key) return "";

  return (
    reviewReasons?.find((reason) => {
      if (!String(reason || "").startsWith("canonical_mutation_blocked:")) {
        return false;
      }
      const reasonService = String(reason || "")
        .split(":")
        .slice(1)
        .join(":");
      return reviewServiceNamesMatchV17_90L241(reasonService, key);
    }) || ""
  );
};

const findPriceContradictionReviewForServiceV17_90L234 = (
  reviewReasons: string[] | null | undefined,
  serviceName?: string | null,
) => {
  const key = normalizeForMatch(serviceName);
  if (!key) return "";

  return (
    reviewReasons?.find((reason) => {
      if (!String(reason || "").startsWith("price_contradiction:")) {
        return false;
      }
      const reasonService = String(reason || "")
        .split(":")
        .slice(1)
        .join(":");
      return normalizeForMatch(reasonService) === key;
    }) || ""
  );
};

const hasCatalogPriceDeviationForItem = (
  item: Pick<OrderItem, "serviceName" | "unit" | "unitPrice"> & {
    description?: string | null;
    catalogReviewConfirmed?: boolean | null;
  },
  services: ServiceDef[],
  reviewReasons?: string[] | null,
) => {
  if (!item?.serviceName?.trim()) return false;
  if (isCatalogReviewConfirmedItem(item)) return false;
  if (hasUnitMismatchReviewForService(reviewReasons, item.serviceName))
    return false;
  if (hasCurrencyMismatchReviewForService(reviewReasons, item.serviceName))
    return false;

  const catalog = findCatalogServiceForName(services, item.serviceName);
  if (!catalog) return false;

  const catalogUnit = normalizePriceUnitForCompare(catalog.unit);
  const itemUnit = normalizePriceUnitForCompare(item.unit);
  if (catalogUnit && itemUnit && catalogUnit !== itemUnit) return false;

  const catalogPrice = Number(catalog.defaultPrice || 0);
  const itemPrice = Number(item.unitPrice || 0);
  if (!Number.isFinite(catalogPrice) || !Number.isFinite(itemPrice))
    return false;
  if (catalogPrice <= 0 || itemPrice <= 0) return false;

  return Math.abs(catalogPrice - itemPrice) >= 0.01;
};

const hasCatalogTextFlatOverrideForItem = (
  item: Pick<OrderItem, "serviceName" | "unit" | "unitPrice" | "quantity"> & {
    description?: string | null;
    catalogReviewConfirmed?: boolean | null;
  },
  services: ServiceDef[],
  reviewReasons?: string[] | null,
) => {
  if (!item?.serviceName?.trim()) return false;
  if (isCatalogReviewConfirmedItem(item)) return false;
  if (hasUnitMismatchReviewForService(reviewReasons, item.serviceName))
    return false;
  if (hasCurrencyMismatchReviewForService(reviewReasons, item.serviceName))
    return false;

  const catalog = findCatalogServiceForName(services, item.serviceName);
  if (!catalog) return false;

  const catalogUnit = normalizePriceUnitForCompare(catalog.unit);
  const itemUnit = normalizePriceUnitForCompare(item.unit);
  if (!catalogUnit || !itemUnit) return false;
  if (catalogUnit === itemUnit) return false;
  if (itemUnit !== "flat") return false;

  const itemPrice = Number(item.unitPrice || 0);
  const itemQuantity = Number(item.quantity || 0);
  return Number.isFinite(itemPrice) && itemPrice > 0 && itemQuantity === 1;
};

const getCatalogPriceDeviationItems = (
  order: Order,
  services: ServiceDef[],
) => {
  const items =
    order.items && order.items.length > 0
      ? order.items
      : order.serviceName
        ? [
            {
              serviceName: order.serviceName,
              description: order.description || order.serviceName,
              quantity: order.quantity,
              unit: order.priceType,
              unitPrice: order.unitPrice,
              totalPrice: order.totalPrice,
            },
          ]
        : [];

  return items.filter((item) =>
    hasCatalogPriceDeviationForItem(item, services, order.reviewReasons),
  );
};

const getCatalogTextFlatOverrideItems = (
  order: Order,
  services: ServiceDef[],
) => {
  const items =
    order.items && order.items.length > 0
      ? order.items
      : order.serviceName
        ? [
            {
              serviceName: order.serviceName,
              description: order.description || order.serviceName,
              quantity: order.quantity,
              unit: order.priceType,
              unitPrice: order.unitPrice,
              totalPrice: order.totalPrice,
            },
          ]
        : [];

  return items.filter((item) =>
    hasCatalogTextFlatOverrideForItem(item, services, order.reviewReasons),
  );
};

const formatReviewUnitLabel = (unit?: string | null) => {
  const normalized = normalizePriceUnitForCompare(unit);
  if (normalized === "square_meter") return "m²";
  if (normalized === "cubic_meter") return "m³";
  if (normalized === "piece") return "Stück";
  if (normalized === "hour") return "Std.";
  if (normalized === "day") return "Tag";
  if (normalized === "meter") return "Meter";
  if (normalized === "flat") return "pauschal";
  return unit || "";
};

const getCatalogMissingItems = (order: Order, services: ServiceDef[]) => {
  const items =
    order.items && order.items.length > 0
      ? order.items
      : order.serviceName
        ? [
            {
              serviceName: order.serviceName,
              description: order.description || order.serviceName,
              quantity: order.quantity,
              unit: order.priceType,
              unitPrice: order.unitPrice,
              totalPrice: order.totalPrice,
              catalogReviewConfirmed: false,
            },
          ]
        : [];

  return items.filter((item) => {
    if (!item?.serviceName?.trim()) return false;
    if (isInternalReviewServiceName(item.serviceName)) return false;
    if ((item as any).catalogReviewConfirmed) return false;
    return !findCatalogServiceForName(services, item.serviceName);
  });
};

const formatCatalogReviewTooltip = (input: {
  title: string;
  item?: Pick<
    OrderItem,
    "serviceName" | "unit" | "unitPrice" | "quantity"
  > | null;
  catalog?: ServiceDef | null;
  currency?: "CHF" | "EUR" | null;
  sourceLine?: string | null;
}) => {
  const currency = input.currency === "EUR" ? "EUR" : "CHF";
  const lines: string[] = [];

  if (input.title) {
    lines.push(input.title.replace(/\.$/, ""));
  }

  if (input.item?.serviceName) {
    lines.push(compactText(input.item.serviceName));
  }

  if (input.item) {
    const itemUnit = input.item.unit || "Einheit prüfen";
    const itemPrice = Number(input.item.unitPrice || 0);
    const itemQuantity = Number(input.item.quantity || 0);
    const itemPriceLabel =
      itemPrice > 0 ? formatCurrency(itemPrice, currency) : "Preis prüfen";
    const itemQuantityLabel =
      itemQuantity > 0 ? String(input.item.quantity) : "Menge prüfen";
    lines.push(
      `Auftrag: ${itemQuantityLabel} ${formatReviewUnitLabel(itemUnit)} · ${itemPriceLabel}`,
    );
  }

  if (input.catalog) {
    lines.push(
      `Katalog: ${formatReviewUnitLabel(input.catalog.unit)} · ${formatCurrency(
        Number(input.catalog.defaultPrice || 0),
        currency,
      )}`,
    );
  }

  if (input.sourceLine?.trim()) {
    lines.push(`Text: ${input.sourceLine.trim()}`);
  }

  return lines.filter(Boolean).join("\n");
};

const uniqueCatalogReviewItems = <
  T extends Pick<OrderItem, "serviceName" | "unit" | "unitPrice" | "quantity">,
>(
  items: T[],
) => {
  const seen = new Set<string>();
  const result: T[] = [];

  items.forEach((item) => {
    const key = [
      normalizeForMatch(item.serviceName),
      normalizePriceUnitForCompare(item.unit),
      Number(item.unitPrice || 0),
      Number(item.quantity || 0),
    ].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });

  return result;
};

const formatCatalogPriceDeviationTooltip = (
  items: Array<
    Pick<OrderItem, "serviceName" | "unit" | "unitPrice" | "quantity">
  >,
  services: ServiceDef[],
  currency?: "CHF" | "EUR" | null,
) => {
  const safeCurrency = currency === "EUR" ? "EUR" : "CHF";
  const reviewItems = uniqueCatalogReviewItems(items).filter((item) =>
    compactText(item.serviceName),
  );

  if (reviewItems.length === 0) {
    return "Preis weicht vom Katalog ab.";
  }

  if (reviewItems.length === 1) {
    const item = reviewItems[0];
    return formatCatalogReviewTooltip({
      title: "Preis weicht vom Katalog ab.",
      item,
      catalog: findCatalogServiceForName(services, item.serviceName),
      currency,
    });
  }

  const lines = [`${reviewItems.length} Preisabweichungen:`];

  reviewItems.forEach((item, index) => {
    const catalog = findCatalogServiceForName(services, item.serviceName);
    const itemQuantity = Number(item.quantity || 0);
    const itemPrice = Number(item.unitPrice || 0);
    const itemQuantityLabel =
      itemQuantity > 0 ? String(item.quantity) : "Menge prüfen";
    const itemPriceLabel =
      itemPrice > 0 ? formatCurrency(itemPrice, safeCurrency) : "Preis prüfen";

    lines.push(`${index + 1}. ${compactText(item.serviceName) || "Leistung"}`);
    lines.push(
      `   Auftrag: ${itemQuantityLabel} ${formatReviewUnitLabel(item.unit || "")} · ${itemPriceLabel}`,
    );
    if (catalog) {
      lines.push(
        `   Katalog: ${formatReviewUnitLabel(catalog.unit)} · ${formatCurrency(
          Number(catalog.defaultPrice || 0),
          safeCurrency,
        )}`,
      );
    } else {
      lines.push("   Katalog: keine passende Leistung gefunden");
    }
  });


  return lines.join("\n");
};

const formatCatalogMissingTooltip = (
  items: Array<
    Pick<OrderItem, "serviceName" | "unit" | "unitPrice" | "quantity">
  >,
  currency?: "CHF" | "EUR" | null,
) => {
  const safeCurrency = currency === "EUR" ? "EUR" : "CHF";
  if (items.length === 0) return "Nicht im Katalog.";

  const lines = [
    items.length > 1
      ? `${items.length} Leistungen nicht im Katalog:`
      : "1 Leistung nicht im Katalog:",
    ...items.map((item) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unitPrice || 0);
      const quantityLabel =
        quantity > 0
          ? `${item.quantity} ${formatReviewUnitLabel(item.unit || "")}`
          : formatReviewUnitLabel(item.unit || "");
      const priceLabel =
        unitPrice > 0
          ? formatCurrency(unitPrice, safeCurrency)
          : "Preis prüfen";
      return `${item.serviceName || "Leistung"} · ${quantityLabel} · ${priceLabel}`;
    }),
  ];


  return lines.filter(Boolean).join("\n");
};

const isManualUnitConfirmedItem = (item?: Partial<OrderItem> | null) =>
  Boolean((item as any)?.manualUnitConfirmed) ||
  isManualUnitConfirmedDescription((item as any)?.description);

const getManualUnitConfirmedUnitForItem = (
  item?: Partial<OrderItem> | null,
) =>
  getManualUnitConfirmedUnitFromItemDescription((item as any)?.description) ||
  compactText((item as any)?.unit || "");

const SERVICE_REVIEW_TOOLTIP_SEPARATOR = "────────────";

const formatServiceReviewCalculation = (
  item: Pick<OrderItem, "unit" | "unitPrice" | "quantity" | "totalPrice">,
  currency?: "CHF" | "EUR" | null,
) => {
  const safeCurrency = currency === "EUR" ? "EUR" : "CHF";
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);
  const totalPrice = Number(
    (item as any).totalPrice ??
      (quantity > 0 && unitPrice > 0 ? quantity * unitPrice : 0),
  );

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(unitPrice) ||
    unitPrice <= 0
  ) {
    return "";
  }

  const quantityLabel =
    `${item.quantity} ${formatReviewUnitLabel(item.unit || "")}`.trim();
  return `${quantityLabel} × ${formatCurrency(unitPrice, safeCurrency)} = ${formatCurrency(totalPrice, safeCurrency)}`;
};

const formatServiceReviewItemLine = (
  item: Pick<
    OrderItem,
    "serviceName" | "unit" | "unitPrice" | "quantity" | "totalPrice"
  >,
  currency?: "CHF" | "EUR" | null,
) => {
  const safeCurrency = currency === "EUR" ? "EUR" : "CHF";
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);
  const quantityLabel =
    quantity > 0
      ? `${item.quantity} ${formatReviewUnitLabel(item.unit || "")}`.trim()
      : "Menge prüfen";
  const priceLabel =
    unitPrice > 0 ? formatCurrency(unitPrice, safeCurrency) : "Preis prüfen";
  const calculation = formatServiceReviewCalculation(item, currency);
  const baseLine = `* ${canonicalServiceNameForOrderItem(item.serviceName) || "Leistung"} — ${quantityLabel} · ${priceLabel}`;

  return calculation ? `${baseLine}\n  Berechnung: ${calculation}` : baseLine;
};

const formatServiceReviewSummaryTooltip = (input: {
  unitConflictServices?: string[];
  priceItems?: Array<
    Pick<
      OrderItem,
      "serviceName" | "unit" | "unitPrice" | "quantity" | "totalPrice"
    >
  >;
  missingItems?: Array<
    Pick<
      OrderItem,
      "serviceName" | "unit" | "unitPrice" | "quantity" | "totalPrice"
    >
  >;
  manualUnitItems?: Array<
    Pick<
      OrderItem,
      "serviceName" | "unit" | "unitPrice" | "quantity" | "totalPrice" | "description"
    >
  >;
  items?: Array<
    Pick<
      OrderItem,
      "serviceName" | "unit" | "unitPrice" | "quantity" | "totalPrice"
    >
  >;
  services: ServiceDef[];
  currency?: "CHF" | "EUR" | null;
}) => {
  const safeCurrency = input.currency === "EUR" ? "EUR" : "CHF";
  const sections: string[] = [];

  const unitServices = Array.from(
    new Set(
      (input.unitConflictServices || [])
        .map(compactText)
        .filter(Boolean)
        .filter((service) => {
          const parts = service.split(":").map(compactText).filter(Boolean);
          const textUnit = normalizeForMatch(parts[1] || "");
          return !(
            textUnit === "pruefen" ||
            textUnit === "prufen" ||
            textUnit === "einheit pruefen" ||
            textUnit === "einheit prufen" ||
            textUnit.includes("unklar") ||
            textUnit.includes("fehlt") ||
            textUnit.includes("missing") ||
            textUnit.includes("unknown") ||
            textUnit.includes("unclear")
          );
        }),
    ),
  );
  if (unitServices.length > 0) {
    const lines = ["Einheit abweichend · Einheit aus Text übernommen"];
    unitServices.forEach((service) => {
      const parts = service.split(":").map(compactText).filter(Boolean);
      const serviceName = canonicalServiceNameForOrderItem(parts[0] || service);
      const textUnit = parts[1] ? formatReviewUnitLabel(parts[1]) : "";
      const catalogUnit = parts[2] ? formatReviewUnitLabel(parts[2]) : "";
      const matchingItem = (input.items || []).find(
        (item) =>
          normalizeForMatch(
            canonicalServiceNameForOrderItem(item.serviceName),
          ) === normalizeForMatch(serviceName),
      );
      const calculation = matchingItem
        ? formatServiceReviewCalculation(matchingItem, input.currency)
        : "";
      if (textUnit || catalogUnit) {
        lines.push(
          `• ${serviceName || "Leistung"} — Kundentext: ${textUnit || "prüfen"}, Katalog: ${catalogUnit || "prüfen"}`,
        );
        if (calculation) lines.push(`  Berechnung: ${calculation}`);
      } else {
        lines.push(`• ${serviceName || "Leistung"}`);
        if (calculation) lines.push(`  Berechnung: ${calculation}`);
      }
    });
    sections.push(lines.join("\n"));
  }

  const manualUnitItems = uniqueCatalogReviewItems(input.manualUnitItems || []).filter(
    (item) => compactText(item.serviceName),
  );
  if (manualUnitItems.length > 0) {
    const lines = ["Einheit ergänzt"];
    manualUnitItems.forEach((item) => {
      const unitLabel = formatReviewUnitLabel(
        getManualUnitConfirmedUnitForItem(item) || item.unit || "",
      );
      const calculation = formatServiceReviewCalculation(item, input.currency);
      lines.push(
        `* ${canonicalServiceNameForOrderItem(item.serviceName) || "Leistung"} — manuell eingetragen: ${unitLabel || "prüfen"}`,
      );
      if (calculation) lines.push(`  Berechnung: ${calculation}`);
    });
    sections.push(lines.join("\n"));
  }

  const priceItems = uniqueCatalogReviewItems(input.priceItems || []).filter(
    (item) => compactText(item.serviceName),
  );
  if (priceItems.length > 0) {
    const lines = ["Preis oder Einheit abweichend"];
    priceItems.forEach((item) => {
      const catalog = findCatalogServiceForName(
        input.services,
        item.serviceName,
      );
      const catalogPrice = catalog
        ? formatCurrency(Number(catalog.defaultPrice || 0), safeCurrency)
        : "kein Katalogpreis";
      const catalogUnit = formatReviewUnitLabel(catalog?.unit || "") || "–";
      const calculation = formatServiceReviewCalculation(item, input.currency);
      lines.push(
        `* ${canonicalServiceNameForOrderItem(item.serviceName) || "Leistung"}`,
      );
      if (calculation) lines.push(`  Aktuell: ${calculation}`);
      lines.push(`  Katalogpreis: ${catalogPrice} / ${catalogUnit}`);
      lines.push("  Preis weicht vom Katalog ab.");
    });
    sections.push(lines.join("\n"));
  }

  const missingItems = uniqueCatalogReviewItems(
    input.missingItems || [],
  ).filter((item) => compactText(item.serviceName));
  if (missingItems.length > 0) {
    const lines = ["Nicht im Leistungskatalog"];
    missingItems.forEach((item) => {
      const calculation = formatServiceReviewCalculation(item, input.currency);
      lines.push(
        `* ${canonicalServiceNameForOrderItem(item.serviceName) || "Leistung"}`,
      );
      if (calculation) lines.push(`  Aktuell: ${calculation}`);
    });
    sections.push(lines.join("\n"));
  }

  return sections.join(`\n${SERVICE_REVIEW_TOOLTIP_SEPARATOR}\n`);
};

const buildUnifiedServiceReviewSummaryV17_90L61 = (input: {
  items: OrderItem[];
  services: ServiceDef[];
  currency?: "CHF" | "EUR" | null;
}) => {
  const safeCurrency = input.currency === "EUR" ? "EUR" : "CHF";
  const deviations: Array<{
    item: OrderItem;
    catalog: ServiceDef;
    sameUnit: boolean;
    samePrice: boolean;
  }> = [];
  const missing: OrderItem[] = [];

  (input.items || []).forEach((item) => {
    const name = canonicalServiceNameForOrderItem(item.serviceName || "");
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const unit = compactText(item.unit || "");
    if (
      !name ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(unitPrice) ||
      unitPrice <= 0 ||
      !unit ||
      /(?:prüfen|pruefen|prufen)/i.test(unit)
    )
      return;

    const nameKey = normalizeForMatch(name);
    const catalog = (input.services || []).find(
      (service) => normalizeForMatch(service?.name || "") === nameKey,
    );
    if (!catalog) {
      missing.push(item);
      return;
    }

    const catalogUnit = compactText(catalog.unit || "");
    const catalogPrice = Number(catalog.defaultPrice || 0);
    const sameUnit = !catalogUnit || unit === catalogUnit;
    const samePrice = Math.abs(unitPrice - catalogPrice) < 0.001;
    if (!sameUnit || !samePrice) {
      deviations.push({ item, catalog, sameUnit, samePrice });
    }
  });

  const sections: string[] = [];
  if (deviations.length > 0) {
    const lines = ["Preis oder Einheit abweichend"];
    deviations.forEach(({ item, catalog, sameUnit, samePrice }) => {
      const calculation = formatServiceReviewCalculation(item, safeCurrency);
      lines.push(
        `* ${canonicalServiceNameForOrderItem(item.serviceName) || "Leistung"}`,
      );
      if (calculation) lines.push(`  Aktuell: ${calculation}`);
      lines.push(
        `  Katalogpreis: ${formatCurrency(Number(catalog.defaultPrice || 0), safeCurrency)} / ${formatReviewUnitLabel(catalog.unit || "") || "–"}`,
      );
      if (!sameUnit) {
        lines.push(
          `  Einheit weicht ab: ${formatReviewUnitLabel(item.unit || "") || "–"} statt ${formatReviewUnitLabel(catalog.unit || "") || "–"}`,
        );
      }
      if (!samePrice) lines.push("  Preis weicht vom Katalog ab.");
    });
    sections.push(lines.join("\n"));
  }

  if (missing.length > 0) {
    const lines = ["Nicht im Leistungskatalog"];
    missing.forEach((item) => {
      const calculation = formatServiceReviewCalculation(item, safeCurrency);
      lines.push(
        `* ${canonicalServiceNameForOrderItem(item.serviceName) || "Leistung"}`,
      );
      if (calculation) lines.push(`  Aktuell: ${calculation}`);
    });
    sections.push(lines.join("\n"));
  }

  return {
    count: deviations.length + missing.length,
    tooltip: sections.join(`\n${SERVICE_REVIEW_TOOLTIP_SEPARATOR}\n`),
  };
};

const buildOrderStructuredServiceReviewV17_90L135G = (
  items: Array<OrderItem | FormItem>,
  services: ServiceDef[],
  currency?: "CHF" | "EUR" | null,
  includeBlockers = false,
) => {
  const safeCurrency = currency === "EUR" ? "EUR" : "CHF";
  const sections = new Map<string, string[]>();
  let count = 0;

  const append = (section: string, lines: string[]) => {
    const existing = sections.get(section) || [];
    if (existing.length > 0) existing.push("");
    existing.push(...lines);
    sections.set(section, existing);
  };

  (items || []).forEach((item) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const normalizedItem: OrderItem = {
      id: "id" in item ? item.id : undefined,
      workSiteId: item.workSiteId || null,
      workSite: item.workSite || null,
      serviceName: item.serviceName || "",
      description:
        "description" in item
          ? item.description || ""
          : item.sourceDescription || item.aiWarning || "",
      quantity,
      unit: item.unit || "",
      unitPrice,
      totalPrice:
        "totalPrice" in item && Number.isFinite(Number(item.totalPrice))
          ? Number(item.totalPrice)
          : quantity > 0 && unitPrice > 0
            ? quantity * unitPrice
            : 0,
    };

    const reason = getOrderServiceReviewReasonV17_90L134(
      normalizedItem,
      services,
    );
    if (!reason) return;
    const isBlocker = [
      "Leistung prüfen",
      "Menge prüfen",
      "Einheit prüfen",
      "Preis prüfen",
    ].includes(reason);
    if (isBlocker && !includeBlockers) return;

    const title = isBlocker
      ? "Preis / Menge / Einheit prüfen"
      : reason === "Nicht im Leistungskatalog"
        ? "Nicht im Leistungskatalog"
        : "Preis oder Einheit abweichend";
    const name = canonicalServiceNameForOrderItem(normalizedItem.serviceName) || "Leistung";
    const lines = [`* ${name}`];
    const calculation = formatServiceReviewCalculation(normalizedItem, safeCurrency);
    if (calculation) lines.push(`Aktuell: ${calculation}`);

    const catalog = findCatalogServiceForName(services, normalizedItem.serviceName);
    if (catalog && !isBlocker) {
      lines.push(
        `Katalogpreis: ${formatCurrency(
          Number(catalog.defaultPrice || 0),
          safeCurrency,
        )} / ${formatReviewUnitLabel(catalog.unit || "") || "–"}`,
      );
    }

    if (reason === "Preis abweichend") {
      lines.push("Preis weicht vom Katalog ab.");
    } else if (reason === "Einheit abweichend") {
      lines.push("Einheit weicht vom Katalog ab.");
    } else if (isBlocker) {
      lines.push(`${reason}.`);
    }

    append(title, lines);
    count += 1;
  });

  const tooltip = Array.from(sections.entries())
    .map(([title, lines]) => [title, ...lines].join("\n"))
    .join(`\n${SERVICE_REVIEW_TOOLTIP_SEPARATOR}\n`);

  return { count, tooltip };
};

const buildOrderServiceReviewGroupsV17_90L135G = (
  order: Order,
  services: ServiceDef[],
  includeBlockers = false,
): OrderServiceReviewGroup[] => {
  const sites = Array.isArray(order.workSites)
    ? [...order.workSites].sort(
        (a, b) =>
          Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)) ||
          Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0),
      )
    : [];
  if (sites.length <= 1) return [];

  const result: OrderServiceReviewGroup[] = [];
  sites.forEach((site, index) => {
    const siteItems = (order.items || []).filter(
      (item) => item.workSiteId === site.id || item.workSite?.id === site.id,
    );
    const summary = buildOrderStructuredServiceReviewV17_90L135G(
      siteItems,
      services,
      order.currency,
      includeBlockers,
    );
    if (summary.count <= 0) return;
    result.push({
      key: site.id || `site_${index}`,
      title:
        compactText(site.siteName) ||
        compactText(site.siteAddress) ||
        `Ausführungsort ${index + 1}`,
      address:
        [
          compactText(site.siteAddress),
          [compactText(site.sitePlz), compactText(site.siteCity)]
            .filter(Boolean)
            .join(" "),
        ]
          .filter(Boolean)
          .join(" · ") || "Adresse nicht angegeben",
      count: summary.count,
      tooltip: summary.tooltip,
    });
  });

  const unassignedItems = (order.items || []).filter(
    (item) => !item.workSiteId && !item.workSite?.id,
  );
  const unassigned = buildOrderStructuredServiceReviewV17_90L135G(
    unassignedItems,
    services,
    order.currency,
    includeBlockers,
  );
  if (unassigned.count > 0) {
    result.push({
      key: "unassigned",
      title: "Ohne zugeordneten Ausführungsort",
      address: "Zuordnung prüfen",
      count: unassigned.count,
      tooltip: unassigned.tooltip,
    });
  }

  return result;
};

const formatCurrencyReviewTooltip = (order: Order, services: ServiceDef[]) => {
  const orderCurrency = order.currency === "EUR" ? "EUR" : "CHF";
  const sourceText = [order.notes, order.description, order.audioTranscript]
    .filter(Boolean)
    .join("\n");
  const sections: string[] = [];
  const mismatchDetails = getActiveCurrencyMismatchReviewDetailsV17_90L78(
    order,
    order.reviewReasons,
  );

  const currencyLines = [
    "Währung prüfen",
    "Unterschiedliche Währungen im Kundentext erkannt. Nicht passende Positionen werden nicht berechnet.",
  ];

  if (mismatchDetails.length > 0) {
    mismatchDetails.slice(0, 8).forEach((detail) => {
      const matchingItem = (order.items || []).find(
        (item) =>
          normalizeForMatch(
            canonicalServiceNameForOrderItem(item.serviceName),
          ) === normalizeForMatch(detail.serviceName),
      );
      const sourceLine = findCustomerTextLineForService(
        sourceText,
        detail.serviceName,
        matchingItem
          ? {
              quantity: matchingItem.quantity,
              unit: matchingItem.unit,
              unitPrice: matchingItem.unitPrice,
            }
          : undefined,
      );

      const originalPrice = Number(matchingItem?.unitPrice || 0);
      const originalCurrency =
        String(
          matchingItem?.detectedCurrency ||
            matchingItem?.currency ||
            detail.textCurrency ||
            "",
        )
          .trim()
          .toUpperCase() || "prüfen";
      const originalLabel =
        originalPrice > 0
          ? `${originalCurrency} ${originalPrice.toFixed(2)}`
          : originalCurrency;
      currencyLines.push(
        `• ${detail.serviceName || "Leistung"} — Original ${originalLabel}, Auftragswährung ${detail.orderCurrency || orderCurrency} · nicht berechnet`,
      );
      if (sourceLine) currencyLines.push(`  Text: ${sourceLine}`);
    });

    if (mismatchDetails.length > 8) {
      currencyLines.push(
        `+${mismatchDetails.length - 8} weitere Währungsprobleme`,
      );
    }
  } else {
    currencyLines.push(
      "• Währung im Auftrag oder Kundentext ist unklar. Auftrag öffnen und Positionen prüfen.",
    );
  }

  sections.push(currencyLines.join("\n"));

  return sections.join(`\n${SERVICE_REVIEW_TOOLTIP_SEPARATOR}\n`);
};

const cleanWorkSiteDisplayName = (value?: string | null) => {
  const original = compactText(value);
  let text = original;
  if (!text) return "";

  const normalizeRoleLabel = (candidate: string) =>
    normalizeForMatch(candidate)
      .replace(/\bstrasse\b/g, "str")
      .replace(/\s+/g, " ")
      .trim();

  const isGenericAddressRoleLabel = (candidate: string) => {
    const key = normalizeRoleLabel(candidate);
    if (!key) return true;

    // V17.63: role labels and broken role-label fragments are not real
    // execution-site names. Do not persist/display fragments like "sadresse".
    // This is deliberately structural UI cleanup, not a service-name mapping.
    if (
      /^(?:adresse|sadresse|ausfuehrungsadresse|ausfuehrungsort|ausfuehrung|arbeitsadresse|arbeitsort|einsatzadresse|einsatzort|objekt|baustelle|abweichend von rechnungsadresse|strasse|strasse str|str|strasse|straße|street|work site|job site|lieu|lieu intervention|adresse de travail)$/.test(
        key,
      )
    ) {
      return true;
    }
    return isBrokenWorkSiteRoleFragmentV17_90L176(candidate);
  };

  // V17.90L281: Alte, bereits gespeicherte Wortreste aus Terminüberschriften
  // sind keine Objekt- oder Arbeitsortnamen. Das ist eine rein strukturelle
  // Bereinigung von Feldbezeichnern und verändert keine echten Adressen.
  const normalizedStructuralNameV17_90L281 = normalizeRoleLabel(text);
  if (
    /^(?:stermin|ausfuehrungstermin|ausfuehrungsdatum|ausfuehrungszeit|execution date|execution time)$/.test(
      normalizedStructuralNameV17_90L281,
    )
  ) {
    return "";
  }

  if (isGenericAddressRoleLabel(text)) return "";

  const stripOperationalTailV17_90L13 = (candidate: string) => {
    const parts = candidate
      .split(/\s*[,;]\s*/)
      .map((part) => compactText(part))
      .filter(Boolean);
    if (parts.length <= 1) return candidate;

    const kept: string[] = [];
    for (const part of parts) {
      const key = normalizeForMatch(part);
      const isOperationalTail = /^(?:nur|kein|keine|bitte|vorher|nachher|danach|sms|whats\s*app|whatsapp|e\s*mail|mail|telefon|tel|anruf|rueckruf|ruckruf|rueckfragen|kontakt|schluessel|schlussel|schlüssel|key|badge|code|torcode|hund|tor\b|leiter|achtung|warnung|gefahr|nicht\s+einfach|zugang|parkieren|parken)\b/.test(key);
      if (isOperationalTail) break;
      kept.push(part);
    }

    return kept.length > 0 ? kept.join(", ") : candidate;
  };

  // Remove generic source markers from the title. Keep the actual object name.
  // V17.90k: also strip French address-role labels and broken leftover
  // fragments such as "sadresse," from "Adresse chantier:". This is
  // structural field-label cleanup, not service-word mapping.
  text = text
    .replace(
      /^(?:sadresse|adresse\s+chantier|adresse\s+de\s+chantier|adresse|arbeitsort|ausführungsort|ausfuehrungsort|ausführung|ausfuehrung|ausführungsadresse|ausfuehrungsadresse|abweichend\s+von\s+rechnungsadresse|einsatzort|objekt|baustelle|job site|work site|lieu|lieu d['’]?intervention|adresse de travail)\s*(?:ist|isch|is|=|:)?\s*[,;:\-–—]?\s*/i,
      "",
    )
    .replace(
      /^(?:wo\s+gemacht\s+werden\s+muss|wo\s+arbeiten\s+sind|wo\s+es\s+gemacht\s+wird)\s*:?\s*/i,
      "",
    )
    .replace(
      /^(?:ist|isch|is)\s+(?:nicht|nöd|noed|not)\s+(?:gleich|gliich)\s*,?\s*/i,
      "",
    )
    .replace(/^(?:nicht|nöd|noed|not)\s+(?:gleich|gliich)\s*,?\s*/i, "")
    .replace(/^[:\-–,\s]+/, "")
    .trim();

  text = stripOperationalTailV17_90L13(text)
    // V17.90L14: remove dangling communication fragments that may have been
    // appended to the execution-site title by the AI, e.g.
    // "Veloraum und Kellerflur, Nur" from "Nur SMS ...". This is structural
    // address cleanup only; no service vocabulary is mapped here.
    .replace(/\s*[,;]\s*(?:nur|bitte\s+nur|kein(?:e|en|em)?\s+(?:whats\s*app|whatsapp)|sms|whats\s*app|whatsapp|e[-\s]*mail|mail|telefon|tel\.?|anruf|rueckruf|ruckruf|kontakt)\b.*$/i, "")
    .replace(/[,:;\s]+$/g, "")
    .trim();

  if (!text || isGenericAddressRoleLabel(text)) return "";
  return text;
};

const formatCompactWorkSiteChipLabelV17_49 = (value?: string | null) => {
  const cleaned = cleanWorkSiteDisplayName(value);
  if (!cleaned) return "";

  // Keep the complete semantic object/site name. The chip itself already
  // truncates visually where space is limited, while hover/tap shows the full
  // structured execution address. Splitting at commas previously turned
  // "Wohnüberbauung Sonnenhof, Häuser A bis D" into only
  // "Wohnüberbauung Sonnenhof" and made Auftrag/Angebot inconsistent.
  return compactText(cleaned).slice(0, 96);
};

const looksLikeExecutionAddressLine = (value?: string | null) => {
  const text = compactText(value);
  if (!text) return false;

  return (
    /\b\d{4,5}\b/.test(text) ||
    /\b(?:strasse|straße|str\.?|weg|gasse|platz|allee|ring|rain|route|rue|chemin|avenue|av\.?|parkstrasse|badenerstrasse|rue\s+du|industrieweg|werkstrasse)\b/i.test(
      text,
    ) ||
    /@/.test(text) ||
    /\b(?:tel\.?|telefon|phone|mobile|handy|email|e-mail)\b/i.test(text)
  );
};

const inferExecutionSiteNameFromText = (
  ...values: Array<string | null | undefined>
) => {
  const source = values
    .filter(Boolean)
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!source.trim()) return "";

  const lines = source
    .split(/\n+/g)
    .map((line) => compactText(line))
    .filter(Boolean);

  // V17.90L281: Der Rollenmarker muss als vollständiges Wort enden.
  // Dadurch kann „Ausführungstermin“ nicht mehr als „Ausführung“ +
  // Objektname „stermin“ zerlegt werden.
  const markerPattern =
    /^(?:ausführung|ausfuehrung|ausführungsort|ausfuehrungsort|ausführungsadresse|ausfuehrungsadresse|arbeitsort|einsatzort|objekt|baustelle|adresse\s+chantier|adresse\s+de\s+chantier|exécution|execution|work\s*site|job\s*site|lieu\s+d['’]?intervention)\b\s*:?\s*(.*)$/i;
  const stopPattern =
    /^(?:rechnung|facture|invoice|leistungen|leistung|besonderheiten|bemerkungen|hinweise|termin|datum|bitte|merci|please|kontakt|rückfragen|rueckfragen)\b/i;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(markerPattern);
    if (!match) continue;

    const inline = cleanWorkSiteDisplayName(match[1]);
    if (inline && !looksLikeExecutionAddressLine(inline)) return inline;

    for (let offset = 1; offset <= 3; offset += 1) {
      const candidate = lines[index + offset];
      if (!candidate || stopPattern.test(candidate)) break;
      if (looksLikeExecutionAddressLine(candidate)) continue;

      const cleaned = cleanWorkSiteDisplayName(candidate);
      if (cleaned && !looksLikeExecutionAddressLine(cleaned)) return cleaned;
    }
  }

  return "";
};

const inferOrderExecutionSiteName = (order?: Order | null) =>
  inferExecutionSiteNameFromText(
    order?.notes,
    order?.description,
    order?.audioTranscript,
  );

const repairOrderWorkSiteNamesForDisplayV17_90L176 = (
  order: Order,
): Order => {
  if (!Array.isArray(order.workSites) || order.workSites.length === 0)
    return order;

  const sections = splitMergedOrderSourceSectionsV17_90L176(order);
  const repairedSites = order.workSites.map((site, index) => {
    const current = cleanWorkSiteDisplayName(site.siteName);
    if (current) return current === site.siteName ? site : { ...site, siteName: current };

    const addressKey = normalizeForMatch(site.siteAddress);
    const placeKey = normalizeForMatch(
      [site.sitePlz, site.siteCity].filter(Boolean).join(" "),
    );
    const matchingSection =
      sections.find((section) => {
        const sectionKey = normalizeForMatch(section);
        return Boolean(
          (addressKey && sectionKey.includes(addressKey)) ||
            (placeKey && sectionKey.includes(placeKey)),
        );
      }) || sections[index];
    const inferred = extractMergedSectionSiteLabelV17_90L176(matchingSection);
    return inferred ? { ...site, siteName: inferred } : { ...site, siteName: null };
  });

  const primary =
    repairedSites.find((site) => site.isPrimary) || repairedSites[0] || null;
  return {
    ...order,
    workSites: repairedSites,
    siteName:
      cleanWorkSiteDisplayName(order.siteName) ||
      cleanWorkSiteDisplayName(primary?.siteName) ||
      null,
  };
};

const formatExecutionAddressTooltip = (order: Order) => {
  const workSites = (order.workSites ?? [])
    .slice()
    .sort(
      (a, b) =>
        Number(b.isPrimary ? 1 : 0) - Number(a.isPrimary ? 1 : 0) ||
        Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0),
    );

  const formatStoredWorkSiteLines = (
    site: {
      siteName?: string | null;
      siteAddress?: string | null;
      sitePlz?: string | null;
      siteCity?: string | null;
      siteNote?: string | null;
    },
    index?: number,
  ) => {
    const siteName = cleanWorkSiteDisplayName(site.siteName);
    const street = compactText(site.siteAddress);
    const place = [site.sitePlz, site.siteCity]
      .map(compactText)
      .filter(Boolean)
      .join(" ");
    const note = compactText(site.siteNote);
    return [
      index != null ? `Arbeitsort ${index + 1}` : "",
      siteName ? `Objekt: ${siteName}` : "",
      `Strasse: ${street || "–"}`,
      `PLZ / Ort: ${place || "–"}`,
      note ? `Hinweis: ${note}` : "",
    ].filter(Boolean);
  };

  if (workSites.length > 0) {
    const visibleSites = workSites.slice(0, 8);
    const siteBlocks = visibleSites.map((site, index) =>
      formatStoredWorkSiteLines(
        site,
        workSites.length > 1 ? index : undefined,
      ).join("\n"),
    );
    const hiddenCount = Math.max(0, workSites.length - visibleSites.length);
    return [
      workSites.length > 1
        ? `Ausführungsorte · ${workSites.length}`
        : "Ausführungsadresse",
      ...siteBlocks.flatMap((block, index) =>
        index > 0 ? ["---", block] : [block],
      ),
      hiddenCount > 0 ? `+${hiddenCount} weitere Arbeitsorte` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const siteName =
    cleanWorkSiteDisplayName(order.siteName) || inferOrderExecutionSiteName(order);
  const street = compactText(order.siteAddress);
  const place = [order.sitePlz, order.siteCity]
    .map(compactText)
    .filter(Boolean)
    .join(" ");
  const note = compactText(order.siteNote);

  return siteName || street || place || note
    ? [
        "Ausführungsadresse",
        siteName ? `Objekt: ${siteName}` : "",
        `Strasse: ${street || "–"}`,
        `PLZ / Ort: ${place || "–"}`,
        note ? `Hinweis: ${note}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "Ausführungsadresse\nArbeit wird an einer anderen Adresse ausgeführt.";
};

const combineCatalogReviewBadges = (badges: ReviewBadge[]) => badges;

const compactRedReviewDetailLinesV17_90L73 = (badge: ReviewBadge) => {
  const labelKey = normalizeForMatch(badge.label);
  const actionLine = /auftrag öffnen|positionen kontrollieren|vorschlag übernehmen|vorschlag verwerfen|rote punkte bearbeiten|angebot|rechnung bleiben/i;
  const boilerplateLine = /wurde erkannt und wird bis zur bestätigung|bestätigten positionen|mindestens eine mögliche leistungszeile|nicht sicher übernommen oder einer falschen position zugeordnet|unterschiedliche währungen im kundentext erkannt/i;

  return cleanVisibleTooltipTextV17_35(badge.tooltip)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => normalizeForMatch(line) !== labelKey)
    .filter((line) => !/^[-–—]{3,}$/.test(line))
    .filter((line) => !actionLine.test(line))
    .filter((line) => !boilerplateLine.test(line))
    .filter((line) => !/^Text:/i.test(line))
    .map((line) => line.replace(/^•\s*/, "").trim())
    .filter(Boolean)
    .map((line) => (line.length > 128 ? `${line.slice(0, 125).trim()}…` : line))
    .slice(0, 6);
};

const redReviewPositionKeysV17_90L242 = (badge: ReviewBadge) => {
  const keys = new Set<string>();
  const details = compactRedReviewDetailLinesV17_90L73(badge);

  details.forEach((line) => {
    const match = line.match(/^(.+?)\s+[—–-]\s+/u);
    if (!match?.[1]) return;

    const rawServiceName = match[1].replace(/^•\s*/, "").trim();
    const serviceName = canonicalServiceNameForOrderItem(rawServiceName);
    const key = normalizeForMatch(serviceName || rawServiceName);
    if (key) keys.add(key);
  });

  return keys;
};

const concreteRedReviewPositionCountV17_90L242 = (
  badges: ReviewBadge[],
) => {
  const positionKeys = new Set<string>();
  let orderLevelReviewCount = 0;

  badges.forEach((badge) => {
    const badgePositionKeys = redReviewPositionKeysV17_90L242(badge);
    if (badgePositionKeys.size > 0) {
      badgePositionKeys.forEach((key) => positionKeys.add(key));
      return;
    }

    // Ein rein auftragsbezogener Blocker ohne konkrete Leistungszeile zählt
    // einmal. Mehrere Prüfgründe derselben Leistung werden dagegen über den
    // Positionsschlüssel oben zusammengeführt.
    orderLevelReviewCount += 1;
  });

  return Math.max(1, positionKeys.size + orderLevelReviewCount);
};

const compactSingleRedReviewTooltipV17_90L73 = (badge: ReviewBadge) => {
  const details = compactRedReviewDetailLinesV17_90L73(badge);
  const cleanLabel = compactText(badge.label).replace(/\s*·\s*\d+\s*$/, "");

  // V17.90L246: A single red chip represents one affected position. Do not
  // render an additional generic heading such as "Widersprüchliche
  // Preisangaben" as if it were a second problem. Keep the same compact,
  // position-first structure used by "Betrag prüfen".
  if (badge.key === "price_contradiction") {
    const serviceRows = details
      .map((line) => line.match(/^(.+?)\s+[—–-]\s+(.+)$/u))
      .filter((match): match is RegExpMatchArray => Boolean(match?.[1]))
      .map((match) => {
        const rawServiceName = match[1].replace(/^•\s*/, "").trim();
        const serviceName =
          canonicalServiceNameForOrderItem(rawServiceName) || rawServiceName;
        return `• ${serviceName} — Preiswiderspruch`;
      });

    return [
      cleanLabel || "Preiswiderspruch",
      ...(serviceRows.length > 0
        ? Array.from(new Set(serviceRows))
        : ["• Preisangaben kontrollieren."]),
    ].join("\n");
  }

  return [
    cleanLabel || badge.label,
    ...(details.length > 0
      ? details.map((line) => `• ${line}`)
      : ["• Offenen Prüfpunkt kontrollieren."]),
  ].join("\n");
};

const RED_REVIEW_SECTION_TITLES_V17_90L73 = new Set([
  "erkennung pruefen",
  "waehrung pruefen",
  "preis pruefen",
  "betrag pruefen",
  "preis oder menge pruefen",
  "preis menge oder einheit ergaenzen",
  "einheit pruefen",
  "preiswiderspruch",
]);

const isRedReviewSectionTitleV17_90L73 = (value?: string | null) =>
  RED_REVIEW_SECTION_TITLES_V17_90L73.has(normalizeForMatch(value));

const renderStructuredRedReviewTooltipV17_90L73 = (
  tooltip: string,
  keyPrefix: string,
) => {
  const lines = cleanVisibleTooltipTextV17_35(tooltip)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => normalizeForMatch(line) !== "auftrag pruefen");

  const sections: Array<{ title: string; rows: string[] }> = [];
  let current: { title: string; rows: string[] } | null = null;

  lines.forEach((line) => {
    if (/^[-─—–_]{3,}$/.test(line)) {
      current = null;
      return;
    }
    if (isRedReviewSectionTitleV17_90L73(line)) {
      current = { title: line, rows: [] };
      sections.push(current);
      return;
    }
    if (!current) {
      current = { title: "Prüfung", rows: [] };
      sections.push(current);
    }
    current.rows.push(line);
  });

  return (
    <span className="block space-y-2">
      {sections.map((section, sectionIndex) => (
        <span
          key={`${keyPrefix}_section_${sectionIndex}`}
          className={`block ${sectionIndex > 0 ? "border-t border-slate-200 pt-2 dark:border-slate-700" : ""}`}
        >
          {!(sections.length === 1 && section.title === "Prüfung") && (
            <span className="mb-1 block font-bold text-slate-950 dark:text-slate-50">
              {section.title}
            </span>
          )}
          <span className="block space-y-1">
            {section.rows.map((rawRow, rowIndex) => {
              const row = rawRow.replace(/^•\s*/, "").trim();
              const [title, ...detailParts] = row.split(/\s+—\s+/);
              const detail = detailParts.join(" — ").trim();
              return (
                <span key={`${keyPrefix}_row_${sectionIndex}_${rowIndex}`} className="block pl-2">
                  <span className="block font-bold text-slate-950 dark:text-slate-50">
                    • {title || row}
                  </span>
                  {detail && (
                    <span className="block pl-3 font-normal text-slate-600 dark:text-slate-300">
                      {detail}
                    </span>
                  )}
                </span>
              );
            })}
          </span>
        </span>
      ))}
    </span>
  );
};

const conciseRedReviewReasonV17_90L245 = (
  badge: ReviewBadge,
  detail: string,
) => {
  if (badge.key === "price_contradiction") return "Preiswiderspruch";
  if (badge.key === "currency_review") return "Währung prüfen";
  if (badge.key === "canonical_mutation") return "Erfassung prüfen";
  if (badge.key === "recognition_review") return "Erkennung prüfen";
  if (badge.key === "unit_conflict") return "Einheit prüfen";

  const normalizedDetail = compactText(detail)
    .replace(/\.$/, "")
    .replace(/Preis oder Menge fehlt\/ist unsicher/i, "Preis oder Menge prüfen")
    .replace(/Preis im Text unklar/i, "Preis prüfen");
  return normalizedDetail || compactText(badge.label).replace(/\s*·\s*\d+\s*$/, "");
};

const consolidateRedReviewRowsV17_90L245 = (badges: ReviewBadge[]) => {
  const rows = new Map<
    string,
    { serviceName: string; reasons: string[] }
  >();
  const orderLevelRows: string[] = [];

  badges.forEach((badge) => {
    const details = compactRedReviewDetailLinesV17_90L73(badge);
    let foundServiceRow = false;

    details.forEach((line) => {
      const match = line.match(/^(.+?)\s+[—–-]\s+(.+)$/u);
      if (!match?.[1]) return;

      foundServiceRow = true;
      const rawServiceName = match[1].replace(/^•\s*/, "").trim();
      const serviceName =
        canonicalServiceNameForOrderItem(rawServiceName) || rawServiceName;
      const key = normalizeForMatch(serviceName);
      if (!key) return;

      const reason = conciseRedReviewReasonV17_90L245(
        badge,
        match[2] || "",
      );
      const existing = rows.get(key) || { serviceName, reasons: [] };
      if (reason && !existing.reasons.includes(reason)) {
        existing.reasons.push(reason);
      }
      rows.set(key, existing);
    });

    if (!foundServiceRow) {
      const label = compactText(badge.label).replace(/\s*·\s*\d+\s*$/, "");
      if (label && !orderLevelRows.includes(label)) orderLevelRows.push(label);
    }
  });

  return [
    ...Array.from(rows.values()).map(
      (entry) =>
        `${entry.serviceName} — ${entry.reasons.join(" · ") || "Prüfen"}`,
    ),
    ...orderLevelRows,
  ];
};

const buildAmountReviewBadges = (badges: ReviewBadge[]): ReviewBadge[] => {
  const redReviewKeys = new Set([
    "currency_review",
    "price_contradiction",
    "canonical_mutation",
    "intake_failure",
    "recognition_review",
    "price_quantity",
    "unit_conflict",
  ]);
  const redBadges = badges.filter(
    (badge) =>
      redReviewKeys.has(badge.key) &&
      /(?:^|\s)(?:bg|text|border)-red-/.test(badge.className || ""),
  );
  const catalogBadges = combineCatalogReviewBadges(
    badges.filter((badge) =>
      ["price_deviation", "catalog_missing", "service_review_summary"].includes(
        badge.key,
      ),
    ),
  );

  if (redBadges.length > 1) {
    const consolidatedRows = consolidateRedReviewRowsV17_90L245(redBadges);
    const concreteReviewCount = consolidatedRows.length > 0
      ? consolidatedRows.length
      : concreteRedReviewPositionCountV17_90L242(redBadges);

    return [
      {
        key: "order_review_summary",
        label: `Auftrag prüfen · ${concreteReviewCount}`,
        className: "bg-red-100 text-red-700 border border-red-300",
        icon: true,
        tooltip: [
          "Auftrag prüfen",
          ...(consolidatedRows.length > 0
            ? consolidatedRows.map((line) => `• ${line}`)
            : ["• Offenen Prüfpunkt kontrollieren."]),
        ].join("\n"),
        focusTarget: "items",
      },
      ...catalogBadges,
    ];
  }

  return [
    ...redBadges.map((badge) => ({
      ...badge,
      tooltip: compactSingleRedReviewTooltipV17_90L73(badge),
    })),
    ...catalogBadges,
  ];
};

const MERGED_CONTACT_DATA_PATTERN =
  /whatsapp|sms|mail|e-?mail|telefon|telefonisch|anruf|anrufen|rückruf|rueckruf|ruckruf|termin|uhr|appointment|call|no calls?|nicht anrufen|keine telefonische/i;

const hasMergedMultipleContactData = (
  order: Order,
  parsedNotes?: ReturnType<typeof splitSpecialNotes>,
) => {
  if (order.reviewReasons?.includes("merged_multiple_contact_data"))
    return true;

  const rawSource = [order.notes, order.specialNotes, order.audioTranscript]
    .filter(Boolean)
    .join("\n");
  const isMergedOrder =
    order.reviewReasons?.includes("manual_order_merge") ||
    order.reviewReasons?.includes("double_merge") ||
    (Array.isArray(order.originOrderIds) && order.originOrderIds.length > 1) ||
    (Array.isArray(order.workSites) && order.workSites.length > 1) ||
    /(?:Hauptauftrag:|Zusammengeführt mit:)/i.test(rawSource);

  if (!isMergedOrder) return false;

  const companyContactKeys = new Set<string>();
  const operationalContactKeys = new Set<string>();
  const phoneKey = (value?: string | null) => {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length >= 7 ? `phone:${digits}` : "";
  };
  const emailKey = (value?: string | null) => {
    const email = compactText(value).toLowerCase();
    return email.includes("@") ? `mail:${email}` : "";
  };

  // Company/billing contact is one role and is never copied to every site.
  const companyPhoneKey = phoneKey(order.customer?.phone);
  const companyEmailKey = emailKey(order.customer?.email);
  if (companyPhoneKey) companyContactKeys.add(companyPhoneKey);
  if (companyEmailKey) companyContactKeys.add(companyEmailKey);

  const operationalLines = rawSource
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => compactText(line))
    .filter(Boolean)
    .filter((line) => !/\b(?:hund|dog|chien|cane|perro)\b/i.test(line))
    .filter((line) =>
      /\b(?:sms|whats\s*app|whatsapp|anrufen|anruf|rückruf|rueckruf|kontakt\s+vor\s+ort|vor\s+arbeitsbeginn|vor\s+ausführung|vor\s+ausfuehrung|erreichbar|melden|e-?mail)\b/i.test(
        line,
      ),
    );

  for (const line of operationalLines) {
    const phones = line.match(/\+?\d[\d\s()./-]{6,}\d/g) || [];
    phones.forEach((phone) => {
      const key = phoneKey(phone);
      if (key) operationalContactKeys.add(key);
    });
    const emails = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    emails.forEach((email) => {
      const key = emailKey(email);
      if (key) operationalContactKeys.add(key);
    });
  }

  const notes = parsedNotes || splitSpecialNotes(order.specialNotes || "");
  const groupedContactLines = notes.jobHints.filter((line) => {
    const value = compactText(line);
    return (
      /^[^:]{2,120}:\s+/.test(value) && MERGED_CONTACT_DATA_PATTERN.test(value)
    );
  });

  return (
    operationalContactKeys.size > 1 ||
    (operationalContactKeys.size > 0 && companyContactKeys.size > 0) ||
    groupedContactLines.length > 1
  );
};

const normalizeAddressPartForCompare = (value?: string | null) =>
  normalizeForMatch(value)
    .replace(/\bstrasse\b/g, "str")
    .replace(/\s+/g, " ")
    .trim();

type AddressReviewCandidateV17_90L36 = {
  siteName: string;
  siteAddress: string;
  sitePlz: string;
  siteCity: string;
  siteNote: string;
};

const EXECUTION_ADDRESS_OPERATIONAL_BOUNDARY_V17_90L39 =
  /\b(?:schlüssel|schluessel|schlussel|key|zugang|zutritt|rezeption|reception|empfang|concierge|hauswart|hausmeister|code|torcode|zugangscode|schlüsselbox|schluesselbox|briefkasten|parkieren|parken|parkplatz|parking|termin|datum|uhrzeit|kontakt(?:person)?|ansprechperson|telefon|tel\.?|handy|natel|whatsapp|sms|e-?mail)\b/i;

const stripOperationalAddressTailV17_90L39 = (value?: string | null) => {
  const text = compactText(value);
  if (!text) return "";
  const match = text.match(EXECUTION_ADDRESS_OPERATIONAL_BOUNDARY_V17_90L39);
  if (!match || match.index == null) return text;
  return text
    .slice(0, match.index)
    .replace(/[,;:\-–—\s]+$/g, "")
    .trim();
};

const isOperationalAddressHintV17_90L39 = (value?: string | null) =>
  EXECUTION_ADDRESS_OPERATIONAL_BOUNDARY_V17_90L39.test(compactText(value));

const repairInlineAddressReviewCandidateV17_90L36 = (
  candidate: AddressReviewCandidateV17_90L36,
): AddressReviewCandidateV17_90L36 => {
  const result: AddressReviewCandidateV17_90L36 = {
    ...candidate,
    siteName: stripOperationalAddressTailV17_90L39(candidate.siteName),
    siteAddress: stripOperationalAddressTailV17_90L39(candidate.siteAddress),
    siteCity: stripOperationalAddressTailV17_90L39(candidate.siteCity),
    // Zugangs-/Schlüsselhinweise gehören in Besonderheiten/Chips und dürfen
    // nicht als dritte Zeile einer erkannten Adresse erscheinen.
    siteNote: isOperationalAddressHintV17_90L39(candidate.siteNote)
      ? ""
      : compactText(candidate.siteNote),
  };
  const source = [result.siteName, result.siteAddress]
    .map(compactText)
    .filter(Boolean)
    .join(", ");

  if (!source) return result;

  const segments = source
    .split(/[,;\n]+/g)
    .map((part) => stripOperationalAddressTailV17_90L39(part))
    .map((part) => part.replace(/[.\s]+$/g, "").trim())
    .filter(Boolean)
    .filter((part) => !isOperationalAddressHintV17_90L39(part));

  const houseNumber = "\\d+[a-zA-Z]?(?:\\s*[/-]\\s*\\d+[a-zA-Z]?)?";
  const streetSuffix =
    "(?:strasse|straße|str\\.?|weg|gasse|platz|allee|ring|rain|halde|steig|street|road|lane)";
  const foreignStreetType =
    "(?:rue|avenue|av\\.?|chemin|quai|boulevard|bd\\.?|place|cours|promenade|impasse|passage|route|via|viale|calle|camino)";
  const word = "[A-ZÄÖÜÀ-ÖØ-Þa-zäöüßà-öø-ÿ][A-Za-zÄÖÜÀ-ÖØ-öø-ÿäöüß'’.-]*";
  const foreignStreetPattern = new RegExp(
    `\\b(${foreignStreetType}\\s+${word}(?:\\s+(?:de|des|du|del|della|la|le|les|l['’]?|d['’]?|${word})){0,8}\\s+${houseNumber})\\b`,
    "i",
  );
  const suffixStreetPattern = new RegExp(
    `\\b((?:${word}\\s+){0,3}${word}${streetSuffix}\\s+${houseNumber})\\b`,
    "i",
  );

  let street = compactText(result.siteAddress);
  let streetSegmentIndex = -1;
  let matchedStreet = "";

  segments.some((segment, index) => {
    const match = segment.match(foreignStreetPattern) || segment.match(suffixStreetPattern);
    if (!match?.[1]) return false;
    matchedStreet = compactText(match[1]);
    streetSegmentIndex = index;
    return true;
  });

  if (!street && matchedStreet) street = matchedStreet;

  let plz = compactText(result.sitePlz);
  let city = compactText(result.siteCity);

  const citySegments = streetSegmentIndex >= 0
    ? segments.slice(streetSegmentIndex + 1)
    : segments;

  for (const segment of citySegments) {
    const plzCityMatch = segment.match(/^\s*(\d{4,5})\s+(.+?)\s*$/);
    if (plzCityMatch) {
      plz = plz || compactText(plzCityMatch[1]);
      city = city || compactText(plzCityMatch[2]);
      break;
    }
  }

  if (!city) {
    const cityOnly = citySegments.find((segment) => {
      const value = compactText(segment);
      return (
        value.length >= 2 &&
        value.length <= 60 &&
        !/\d/.test(value) &&
        /[A-Za-zÄÖÜÀ-ÖØ-öø-ÿäöüß]/.test(value)
      );
    });
    city = compactText(cityOnly);
  }

  let siteName = compactText(result.siteName);
  if (streetSegmentIndex > 0) {
    siteName = compactText(segments.slice(0, streetSegmentIndex).join(", "));
  } else if (matchedStreet && siteName) {
    siteName = compactText(
      siteName
        .replace(new RegExp(matchedStreet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "")
        .replace(/[,;\s]+$/g, ""),
    );
  }

  return {
    siteName,
    siteAddress: street,
    sitePlz: plz,
    siteCity: city,
    siteNote: isOperationalAddressHintV17_90L39(result.siteNote)
      ? ""
      : compactText(result.siteNote),
  };
};

const orderExecutionAddressEvidenceSourceV17_90L38 = (order?: Order | null) =>
  Array.from(
    new Set(
      [
        order?.notes,
        order?.audioTranscript,
        order?.description,
        order?.specialNotes,
        ...(order?.items || []).flatMap((item) => [
          item?.description || "",
          item?.serviceName || "",
        ]),
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ).join("\n");

const SAME_ADDRESS_EXECUTION_INTENT_PATTERNS_V17_90L94 = [
  /\b(?:gleiche(?:n|r|s|m)?|derselbe(?:n|r|s|m)?|identische(?:n|r|s|m)?)\s+(?:rechnungs)?adresse\b/i,
  /\bsame\s+(?:street\s+)?address\b/i,
  /\b(?:même|meme)\s+adresse\b/i,
  /\bstesso\s+indirizzo\b/i,
  /\bmisma\s+direcci[oó]n\b/i,
  /\b(?:keine|kein)\s+(?:abweichende|separate)\s+(?:ausführungs|ausfuehrungs|arbeits|einsatz)?adresse\b/i,
  /\bno\s+(?:separate|different)\s+(?:execution|work|job)?\s*(?:street\s+)?address\b/i,
  /\b(?:pas|aucune)\s+d['’]?adresse\s+(?:d['’]?)?(?:exécution|execution|travail)\s+(?:séparée|separee|différente|differente)\b/i,
  /\bnessun\s+indirizzo\s+(?:di\s+lavoro\s+)?(?:separato|diverso)\b/i,
];

const SAME_ADDRESS_POSITIVE_PATTERN_V17_90L94 =
  /\b(?:gleiche(?:n|r|s|m)?|derselbe(?:n|r|s|m)?|identische(?:n|r|s|m)?)\s+(?:rechnungs)?adresse\b|\bsame\s+(?:street\s+)?address\b|\b(?:même|meme)\s+adresse\b|\bstesso\s+indirizzo\b|\bmisma\s+direcci[oó]n\b/i;

const inferSameAddressExecutionReviewCandidateV17_90L94 = (
  order?: Order | null,
): AddressReviewCandidateV17_90L36 | null => {
  if (!order?.customer) return null;

  const billingAddress = compactText(order.customer.address);
  const billingPlz = compactText(order.customer.plz);
  const billingCity = compactText(order.customer.city);
  if (!billingAddress || !billingPlz || !billingCity) return null;

  const source = orderExecutionAddressEvidenceSourceV17_90L38(order);
  if (!source) return null;

  const hasSameAddressIntent = SAME_ADDRESS_EXECUTION_INTENT_PATTERNS_V17_90L94.some(
    (pattern) => pattern.test(source),
  );
  if (!hasSameAddressIntent) return null;

  let siteName = "";
  const segments = source
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((part) => compactText(part))
    .filter(Boolean);

  for (const segment of segments) {
    const match = segment.match(SAME_ADDRESS_POSITIVE_PATTERN_V17_90L94);
    if (!match || match.index == null) continue;

    const tail = segment
      .slice(match.index + match[0].length)
      .replace(
        /^\s*(?:statt|stattfindet|findet\s+statt|befindet\s+sich|located|is\s+located|are\s+located|si\s+trova|se\s+trouve)?\s*[,;:\-–—]?\s*/i,
        "",
      )
      .replace(/^(?:im|in|am|auf|at|dans|au|aux|nel|nella|al|en)\s+/i, "")
      .replace(/[.;]+$/g, "")
      .trim();

    const cleaned = cleanWorkSiteDisplayName(tail);
    if (cleaned && !looksLikeExecutionAddressLine(cleaned)) {
      siteName = cleaned;
      break;
    }
  }

  return {
    siteName,
    siteAddress: billingAddress,
    sitePlz: billingPlz,
    siteCity: billingCity,
    siteNote: "",
  };
};

const getExecutionAddressReviewCandidateFromOrderV17_90L38 = (
  order?: Order | null,
): AddressReviewCandidateV17_90L36 => {
  const workSites = Array.isArray(order?.workSites) ? order!.workSites! : [];
  const primarySite =
    workSites.find((site) => Boolean(site.isPrimary)) || workSites[0] || null;
  const extracted = order
    ? extractExecutionAddressFromText(
        orderExecutionAddressEvidenceSourceV17_90L38(order),
        {
          customerAddress: order.customer?.address,
          customerPlz: order.customer?.plz,
          customerCity: order.customer?.city,
        },
      )
    : null;
  const sameAddressFallback =
    inferSameAddressExecutionReviewCandidateV17_90L94(order);

  return repairInlineAddressReviewCandidateV17_90L36({
    siteName:
      cleanWorkSiteDisplayName(primarySite?.siteName || order?.siteName) ||
      cleanWorkSiteDisplayName(extracted?.siteName) ||
      cleanWorkSiteDisplayName(sameAddressFallback?.siteName) ||
      "",
    siteAddress:
      compactText(primarySite?.siteAddress || order?.siteAddress) ||
      compactText(extracted?.siteAddress) ||
      compactText(sameAddressFallback?.siteAddress) ||
      "",
    sitePlz:
      compactText(primarySite?.sitePlz || order?.sitePlz) ||
      compactText(extracted?.sitePlz) ||
      compactText(sameAddressFallback?.sitePlz) ||
      "",
    siteCity:
      compactText(primarySite?.siteCity || order?.siteCity) ||
      compactText(extracted?.siteCity) ||
      compactText(sameAddressFallback?.siteCity) ||
      "",
    siteNote:
      compactText(primarySite?.siteNote || order?.siteNote) ||
      compactText(extracted?.siteNote) ||
      "",
  });
};

const hasDifferentExecutionAddressForBadge = (order: Order) => {
  if (!order.siteAddressDifferent) return false;

  const workSites = Array.isArray(order.workSites) ? order.workSites : [];
  const completeWorkSites = workSites.filter((site) =>
    Boolean(
      compactText(site?.siteAddress) &&
        compactText(site?.sitePlz) &&
        compactText(site?.siteCity),
    ),
  );

  // V17.90L280: Multi-Site-Aufträge bleiben uneingeschränkt erhalten.
  // Ein separater Einzel-Arbeitsort ist dagegen nur mit vollständiger
  // strukturierter Adresse gültig. Name-only-Restwerte wie "stermin"
  // dürfen nach einem Dokument-Rückweg keinen Ausführungsort aktivieren.
  if (completeWorkSites.length > 1) return true;

  const firstSite = completeWorkSites[0] || workSites[0] || null;
  const siteStreet = normalizeAddressPartForCompare(
    firstSite?.siteAddress || order.siteAddress,
  );
  const sitePlz = normalizeAddressPartForCompare(
    firstSite?.sitePlz || order.sitePlz,
  );
  const siteCity = normalizeAddressPartForCompare(
    firstSite?.siteCity || order.siteCity,
  );

  // Ein separater Arbeitsort ohne vollständige Adresse ist kein gültiger
  // Ausführungsort. Damit bleiben Karte und Editor fail-closed.
  if (!siteStreet || !sitePlz || !siteCity) return false;

  const customerStreet = normalizeAddressPartForCompare(
    order.customer?.address,
  );
  const customerPlz = normalizeAddressPartForCompare(order.customer?.plz);
  const customerCity = normalizeAddressPartForCompare(order.customer?.city);

  const hasCompleteComparableAddress = Boolean(
    customerStreet && customerPlz && customerCity,
  );

  if (
    hasCompleteComparableAddress &&
    siteStreet === customerStreet &&
    sitePlz === customerPlz &&
    siteCity === customerCity
  ) {
    return false;
  }

  return true;
};

const hasAddressRoleReviewReasonV17_61 = (order: Order) =>
  order.reviewReasons?.some(
    (reason) =>
      reason === "address_role_uncertain" ||
      reason === "customer_address_quarantined_ambiguous_role_v17_61" ||
      reason === "execution_address_incomplete" ||
      reason === "intake_risk:execution_address_incomplete" ||
      reason.startsWith("intake_address:"),
  ) ?? false;

const hasResolvableStoredExecutionAddressV17_90K = (order: Order) => {
  if (!hasAddressRoleReviewReasonV17_61(order)) return false;

  const sites = Array.isArray(order.workSites) ? order.workSites : [];
  const primary = sites.find((site) => Boolean(site.isPrimary)) || sites[0];
  const address = compactText(primary?.siteAddress || order.siteAddress);
  const plz = compactText(primary?.sitePlz || order.sitePlz);
  const city = compactText(primary?.siteCity || order.siteCity);

  return Boolean(address && plz && city && hasDifferentExecutionAddressForBadge(order));
};

const hasCompleteSameExecutionAddressAsCustomerV17_90L28 = (order: Order) => {
  const sites = Array.isArray(order.workSites) ? order.workSites : [];
  const primary = sites.find((site) => Boolean(site.isPrimary)) || sites[0] || null;
  const siteAddress = compactText(primary?.siteAddress || order.siteAddress);
  const sitePlz = compactText(primary?.sitePlz || order.sitePlz);
  const siteCity = compactText(primary?.siteCity || order.siteCity);

  if (!siteAddress || !sitePlz || !siteCity) return false;

  return (
    normalizeAddressPartForCompare(siteAddress) ===
      normalizeAddressPartForCompare(order.customer?.address) &&
    normalizeAddressPartForCompare(sitePlz) ===
      normalizeAddressPartForCompare(order.customer?.plz) &&
    normalizeAddressPartForCompare(siteCity) ===
      normalizeAddressPartForCompare(order.customer?.city)
  );
};

const hasActiveAddressRoleReviewV17_90K = (order: Order) =>
  hasAddressRoleReviewReasonV17_61(order) &&
  !hasCompleteSameExecutionAddressAsCustomerV17_90L28(order) &&
  !hasResolvableStoredExecutionAddressV17_90K(order);

const formatAddressRoleReviewTooltipV17_61 = (order: Order) => {
  const candidate =
    getExecutionAddressReviewCandidateFromOrderV17_90L38(order);
  const siteTitle = cleanWorkSiteDisplayName(candidate.siteName);
  const siteAddress = compactText(candidate.siteAddress);
  const sitePlz = compactText(candidate.sitePlz);
  const siteCity = compactText(candidate.siteCity);
  const sitePlace = [sitePlz, siteCity].filter(Boolean).join(" ");

  const lines = ["Ausführadresse unklar"];
  const addressLine = [siteTitle, siteAddress, sitePlace]
    .filter(Boolean)
    .join(" · ");

  if (addressLine) {
    lines.push(`Erkannt: ${addressLine}`);
  }

  const missing: string[] = [];
  if (!siteAddress) missing.push("Strasse fehlt");
  if (!sitePlz) missing.push("PLZ fehlt");
  if (!siteCity) missing.push("Ort fehlt");

  if (missing.length > 0) {
    lines.push(`Warum: ${missing.join(", ")}`);
  } else {
    lines.push("Warum: Ausführungsadresse konnte nicht sicher von der Rechnungsadresse getrennt werden.");
  }

  lines.push("Aktion: Ausführungsadresse oben im Auftrag kontrollieren, übernehmen oder bearbeiten.");
  return lines.join("\n");
};

const getSystemBadges = (
  order: Order,
  services: ServiceDef[] = [],
): ReviewBadge[] => {
  const badges: ReviewBadge[] = [];

  const workSiteCount = Array.isArray(order.workSites)
    ? order.workSites.length
    : 0;
  const primaryWorkSite =
    (order.workSites ?? []).find((site) => Boolean(site?.isPrimary)) ||
    (order.workSites ?? [])[0] ||
    null;
  const explicitExecutionSiteTitle =
    cleanWorkSiteDisplayName(primaryWorkSite?.siteName) ||
    cleanWorkSiteDisplayName(order.siteName);
  const executionSiteTitle =
    explicitExecutionSiteTitle || inferOrderExecutionSiteName(order);
  const executionSiteChipLabel =
    formatCompactWorkSiteChipLabelV17_49(executionSiteTitle) ||
    executionSiteTitle;

  // L67: Ein fachlich benannter Arbeitsbereich (z. B. „Gemeinschaftsraum
  // und Keller“) bleibt auf der Karte sichtbar, auch wenn Rechnungs- und
  // Ausführungsadresse identisch sind. Nur eine echte offene Adressprüfung
  // unterdrückt den normalen cyanfarbenen Ausführungsort-Chip.
  const hasValidDifferentExecutionAddress =
    hasDifferentExecutionAddressForBadge(order);
  const hasNamedSameAddressWorkArea = Boolean(
    !order.siteAddressDifferent && compactText(explicitExecutionSiteTitle),
  );

  if (
    (hasValidDifferentExecutionAddress || hasNamedSameAddressWorkArea) &&
    !hasActiveAddressRoleReviewV17_90K(order)
  ) {
    pushUniqueBadge(badges, {
      key: "site_address",
      label:
        workSiteCount > 1
          ? `Ausführungsorte · ${workSiteCount}`
          : executionSiteChipLabel || "Ausführungsadresse",
      className: "bg-cyan-50 text-cyan-800 border border-cyan-300",
      tooltip: formatExecutionAddressTooltip(order),
    });
  }

  if (hasActiveAddressRoleReviewV17_90K(order)) {
    pushUniqueBadge(badges, {
      key: "address_review",
      label: "Ausführadresse unklar",
      className: "bg-red-100 text-red-700 border border-red-300",
      icon: true,
      tooltip: formatAddressRoleReviewTooltipV17_61(order),
      focusTarget: "executionAddress",
    });
  }

  const isMergedOrder =
    order.reviewReasons?.includes("manual_order_merge") ||
    order.reviewReasons?.includes("double_merge");

  if (isMergedOrder) {
    const originCount = Array.isArray(order.originOrderIds)
      ? order.originOrderIds.filter(Boolean).length
      : 0;
    const mergedCount = originCount > 1 ? originCount : 0;
    pushUniqueBadge(badges, {
      key: "merged",
      label:
        mergedCount > 0
          ? `Zusammengeführt · ${mergedCount}`
          : "Zusammengeführt",
      className: "bg-blue-100 text-blue-700 border border-blue-300",
      tooltip:
        mergedCount > 0
          ? `${mergedCount} Aufträge verbunden.`
          : "Mehrere Aufträge verbunden.",
    });
  }

  const unitMissingServiceNames = Array.from(
    new Set(
      (order.reviewReasons ?? [])
        .filter((reason) => reason.startsWith("unit_missing_in_text:"))
        .map((reason) => reason.split(":").slice(1).join(":"))
        .map(compactText)
        .map(canonicalServiceNameForOrderItem)
        .filter(Boolean),
    ),
  );

  const isUnitMissingServiceName = (value?: string | null) => {
    const key = normalizeForMatch(canonicalServiceNameForOrderItem(value));
    if (!key) return false;
    return unitMissingServiceNames.some(
      (serviceName) => normalizeForMatch(serviceName) === key,
    );
  };

  const isUnitMissingReviewText = (value?: string | null) => {
    const key = normalizeForMatch(value);
    if (!key) return false;
    return (
      key === "pruefen" ||
      key === "prufen" ||
      key === "einheit pruefen" ||
      key === "einheit prufen" ||
      key.includes("einheit fehlt") ||
      key.includes("einheit unklar") ||
      key.includes("einheit offen") ||
      key.includes("unit missing") ||
      key.includes("unit unknown") ||
      key.includes("unit unclear") ||
      key.includes("unit review")
    );
  };

  const isUnitMissingReviewItem = (item?: Partial<OrderItem> | null) => {
    if (!item) return false;
    const unitKey = normalizeForMatch((item as any).unit);
    const reviewText = normalizeForMatch(
      [
        (item as any).unit,
        (item as any).description,
        (item as any).reviewReason,
        (item as any).sourceText,
        (item as any).evidence,
      ]
        .filter(Boolean)
        .join(" "),
    );
    return (
      isUnitMissingServiceName((item as any).serviceName) ||
      unitKey === "pruefen" ||
      unitKey === "prufen" ||
      unitKey === "einheit pruefen" ||
      unitKey === "einheit prufen" ||
      isUnitMissingReviewText(reviewText)
    );
  };

  const hasUnitMissingReviewForService = (value?: string | null) => {
    const target = normalizeForMatch(canonicalServiceNameForOrderItem(value));
    if (!target) return false;
    return (order.items || []).some((item) => {
      if (!isUnitMissingReviewItem(item)) return false;
      const itemName = normalizeForMatch(
        canonicalServiceNameForOrderItem(item.serviceName),
      );
      return (
        itemName === target ||
        itemName.includes(target) ||
        target.includes(itemName)
      );
    });
  };

  const effectiveCurrencyReviewReasons =
    effectiveOrderReviewReasonsV17_90L37(order);
  const activeCurrencyReviewServiceKeys = new Set(
    getActiveCurrencyMismatchReviewDetailsV17_90L78(
      order,
      effectiveCurrencyReviewReasons,
    ).map((detail) =>
      normalizeForMatch(
        canonicalServiceNameForOrderItem(detail.serviceName),
      ),
    ),
  );

  const priceQuantityReviewDetails =
    order.items && order.items.length > 0
      ? order.items.flatMap((it) => {
          const quantity = Number(it.quantity || 0);
          const unitPrice = Number(it.unitPrice || 0);
          const totalPrice = Number((it as any).totalPrice || 0);
          const text = [
            it.unit,
            it.serviceName,
            it.description,
            (it as any).sourceText,
            (it as any).evidence,
            (it as any).reviewReason,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          const normalizedServiceName = normalizeForMatch(it.serviceName || "");
          const serviceIsOpen =
            !normalizedServiceName ||
            normalizedServiceName === "leistung pruefen" ||
            normalizedServiceName === "leistung prufen" ||
            normalizedServiceName.includes("leistung suchen") ||
            normalizedServiceName.includes("eingeben");
          const explicitReviewZeroTotal =
            totalPrice <= 0 &&
            (serviceIsOpen ||
              /leistung\s+(?:oder\s+einheit\s+)?(?:unklar|offen|pr[üu]fen)/i.test(text) ||
              /service[_\s-]*(?:action[_\s-]*)?(?:unclear|review)/i.test(text) ||
              /einheit\s+(?:fehlt|offen|unklar|pr[üu]fen|muss)/i.test(text) ||
              /unit\s+(?:missing|open|unknown|unclear|review)/i.test(text) ||
              /preis\s+(?:fehlt|offen|unklar|pr[üu]fen)/i.test(text) ||
              /price\s+(?:missing|open|unknown|unclear|review)/i.test(text) ||
              /nicht\s+in\s+(?:netto|mwst|total)/i.test(text));
          const itemServiceKey = normalizeForMatch(
            canonicalServiceNameForOrderItem(it.serviceName),
          );
          const isCurrencyOnlyBlocker =
            activeCurrencyReviewServiceKeys.has(itemServiceKey) &&
            !serviceIsOpen &&
            !isUnitMissingReviewItem(it);

          if (isCurrencyOnlyBlocker) return [];

          const issues: string[] = [];
          if (quantity <= 0) issues.push("Menge prüfen");
          if (unitPrice <= 0) issues.push("Preis prüfen");
          if (issues.length === 0 && explicitReviewZeroTotal) {
            issues.push(
              isUnitMissingReviewItem(it) ? "Einheit prüfen" : "Betrag prüfen",
            );
          }
          if (issues.length === 0) return [];

          const serviceName =
            canonicalServiceNameForOrderItem(it.serviceName) ||
            compactText(it.serviceName) ||
            "Leistung";
          return [`${serviceName} — ${issues.join(" und ")}`];
        })
      : Number(order.unitPrice || 0) <= 0 || Number(order.quantity || 0) <= 0
        ? [
            `${canonicalServiceNameForOrderItem(order.serviceName) || "Leistung"} — Preis oder Menge prüfen`,
          ]
        : [];

  const hasPriceQuantityReview = priceQuantityReviewDetails.length > 0;

  // Rote Betragschips nur bei echten Blockern anzeigen.
  // Textpreis/Katalogabweichung mit vorhandenen Werten bleibt gelb,
  // sonst wirkt ein korrekt berechneter Auftrag unnötig gesperrt.
  if (hasPriceQuantityReview) {
    pushUniqueBadge(badges, {
      key: "price_quantity",
      label: "Betrag prüfen",
      className: "bg-red-100 text-red-700 border border-red-300",
      icon: true,
      tooltip: [
        "Betrag prüfen",
        ...priceQuantityReviewDetails.map((line) => `• ${line}`),
      ].join("\n"),
    });
  }

  const unitConflictServices = Array.from(
    new Set(
      (order.reviewReasons ?? [])
        .filter((reason) => reason.startsWith("unit_mismatch:"))
        .map((reason) => {
          const parts = reason
            .split(":")
            .slice(1)
            .map(compactText)
            .filter(Boolean);
          const rawService = parts[0] || "";
          const serviceName = canonicalServiceNameForOrderItem(rawService);
          if (!serviceName) return "";

          if (isUnitMissingServiceName(serviceName)) return "";

          const textUnitRaw = parts[1] || "";
          if (isUnitMissingReviewText(textUnitRaw)) return "";

          const matchingItem = (order.items || []).find(
            (item) =>
              normalizeForMatch(
                canonicalServiceNameForOrderItem(item.serviceName),
              ) === normalizeForMatch(serviceName),
          );
          const matchingSourceEvidence = matchingItem
            ? [
                (matchingItem as any).sourceText,
                (matchingItem as any).evidence,
                matchingItem.description,
              ]
                .filter(Boolean)
                .join(" ")
            : "";
          if (
            isUnitMissingReviewItem(matchingItem) ||
            hasUnitMissingReviewForService(serviceName) ||
            (matchingItem &&
              recognitionEvidenceMentionsUnitV17_90L80(
                matchingSourceEvidence,
                matchingItem.unit,
              ))
          )
            return "";

          const catalog = findCatalogServiceForName(services, serviceName);
          const itemUnit = matchingItem?.unit || parts[1] || "";
          const catalogUnit = catalog?.unit || parts[2] || "";

          const itemUnitKey = normalizePriceUnitForCompare(itemUnit);
          const catalogUnitKey = normalizePriceUnitForCompare(catalogUnit);
          if (itemUnitKey && catalogUnitKey && itemUnitKey === catalogUnitKey) {
            return "";
          }

          return [
            serviceName,
            itemUnit || "Einheit prüfen",
            catalogUnit || "Katalog prüfen",
          ].join(":");
        })
        .filter(Boolean),
    ),
  );
  const hasUnitConflict = unitConflictServices.length > 0;

  if (hasUnitConflict) {
    const unitConflictIsBlocking = hasPriceQuantityReview;
    pushUniqueBadge(badges, {
      key: "unit_conflict",
      label: unitConflictIsBlocking ? "Einheit prüfen" : "Einheit abweichend",
      className: unitConflictIsBlocking
        ? "bg-red-100 text-red-700 border border-red-300"
        : "bg-amber-100 text-amber-800 border border-amber-300",
      tooltip:
        formatServiceReviewSummaryTooltip({
          unitConflictServices,
          items: order.items || [],
          services,
          currency: order.currency,
        }) || "Einheit abweichend.",
    });
  }

  if (hasRecognitionReviewV17_90L69(order)) {
    pushUniqueBadge(badges, {
      key: "recognition_review",
      label: "Erkennung prüfen",
      className: "bg-red-100 text-red-700 border border-red-300",
      icon: true,
      tooltip: formatRecognitionReviewTooltipV17_90L69(order),
      focusTarget: "items",
    });
  }

  // V17.90L36b: Alte Intake-Diagnosen dürfen keinen pauschalen roten
  // "Auftrag prüfen"-Chip erzeugen. Aktuelle harte Fehler werden bereits
  // konkret als Kunde, Ausführadresse, Währung, Betrag oder Einheit angezeigt.

  const activeCurrencyMismatchDetails =
    getActiveCurrencyMismatchReviewDetailsV17_90L78(
      order,
      effectiveCurrencyReviewReasons,
    );
  const hasCurrencyReview =
    activeCurrencyMismatchDetails.length > 0 ||
    hasGlobalCurrencyReviewWithoutItemDetails(
      effectiveCurrencyReviewReasons,
    );

  if (hasCurrencyReview) {
    pushUniqueBadge(badges, {
      key: "currency_review",
      label: "Währung prüfen",
      className: "bg-red-100 text-red-700 border border-red-300",
      icon: true,
      tooltip: formatCurrencyReviewTooltip(
        { ...order, reviewReasons: effectiveCurrencyReviewReasons },
        services,
      ),
    });
  }

  const priceUnclearServiceKeysV17_90L245 = new Set(
    (order.reviewReasons || [])
      .filter((reason) => String(reason || "").startsWith("price_unclear:"))
      .map((reason) =>
        normalizeForMatch(
          canonicalServiceNameForOrderItem(
            String(reason || "").split(":").slice(1).join(":"),
          ),
        ),
      )
      .filter(Boolean),
  );

  const priceContradictionServiceNamesV17_90L234 = Array.from(
    new Set(
      (order.reviewReasons || [])
        .filter((reason) =>
          String(reason || "").startsWith("price_contradiction:"),
        )
        .map((reason) =>
          canonicalServiceNameForOrderItem(
            String(reason || "").split(":").slice(1).join(":"),
          ),
        )
        .map(compactText)
        .filter((serviceName) => {
          if (!serviceName) return false;
          const serviceKey = normalizeForMatch(serviceName);
          const matchingItem = (order.items || []).find(
            (item) =>
              normalizeForMatch(
                canonicalServiceNameForOrderItem(item.serviceName),
              ) === serviceKey,
          );
          // V17.90L245: Eine Position mit offenem Preis ist „Preis prüfen“ und
          // darf nicht zusätzlich als Preiswiderspruch erscheinen. Das hält den
          // roten Außenchip positionsgenau und verhindert doppelte Popover-Zeilen.
          return !(
            priceUnclearServiceKeysV17_90L245.has(serviceKey) ||
            Number(matchingItem?.unitPrice || 0) <= 0
          );
        }),
    ),
  );

  if (priceContradictionServiceNamesV17_90L234.length > 0) {
    pushUniqueBadge(badges, {
      key: "price_contradiction",
      label: `Preiswiderspruch · ${priceContradictionServiceNamesV17_90L234.length}`,
      className: "bg-red-100 text-red-700 border border-red-300",
      icon: true,
      tooltip: [
        "Widersprüchliche Preisangaben",
        ...priceContradictionServiceNamesV17_90L234.map(
          (serviceName) =>
            `• ${serviceName} — Gesamt-/Pauschalpreis und Preis je Einheit widersprechen sich. Bitte kontrollieren und freigeben.`,
        ),
      ].join("\n"),
      focusTarget: "items",
    });
  }

  const canonicalMutationServiceNamesV17_90L235 = Array.from(
    new Set(
      (order.reviewReasons || [])
        .filter((reason) =>
          String(reason || "").startsWith("canonical_mutation_blocked:"),
        )
        .map((reason) =>
          canonicalServiceNameForOrderItem(
            String(reason || "").split(":").slice(1).join(":"),
          ),
        )
        .map(compactText)
        .filter(Boolean),
    ),
  );

  if (canonicalMutationServiceNamesV17_90L235.length > 0) {
    pushUniqueBadge(badges, {
      key: "canonical_mutation",
      label: `Erfassung prüfen · ${canonicalMutationServiceNamesV17_90L235.length}`,
      className: "bg-red-100 text-red-700 border border-red-300",
      icon: true,
      tooltip: [
        "Erfassung sicherheitshalber blockiert",
        ...canonicalMutationServiceNamesV17_90L235.map(
          (serviceName) =>
            `• ${serviceName} — Eine nachgelagerte Verarbeitung wollte kanonische Leistungsdaten verändern. Der letzte sichere KI-Stand wurde erhalten; bitte kontrollieren und freigeben.`,
        ),
      ].join("\n"),
      focusTarget: "items",
    });
  }

  const intakeFailureReasonsV17_90L235 = (order.reviewReasons || []).filter(
    (reason) =>
      String(reason || "").startsWith("intake_processing_error:"),
  );

  if (intakeFailureReasonsV17_90L235.length > 0) {
    pushUniqueBadge(badges, {
      key: "intake_failure",
      label: "Erfassung unvollständig",
      className: "bg-red-100 text-red-700 border border-red-300",
      icon: true,
      tooltip: [
        "Erfassung unvollständig",
        "• Die Nachricht wurde trotz eines technischen Erfassungsfehlers als Prüfauftrag gespeichert.",
        "• Vollständige Kundennachricht kontrollieren und fehlende Daten manuell ergänzen.",
        "• Angebot und Rechnung bleiben bis zur Korrektur blockiert.",
      ].join("\n"),
      focusTarget: "items",
    });
  }

  const manualUnitItems = uniqueCatalogReviewItems(
    (order.items || []).filter((item) => isManualUnitConfirmedItem(item)),
  );

  if (manualUnitItems.length > 0) {
    pushUniqueBadge(badges, {
      key: "manual_unit_confirmed",
      label: "Einheit ergänzt",
      className:
        "bg-yellow-100 text-yellow-900 border border-yellow-400 shadow-sm ring-1 ring-yellow-200/70",
      tooltip:
        formatServiceReviewSummaryTooltip({
          manualUnitItems,
          items: order.items || [],
          services,
          currency: order.currency,
        }) || "Einheit manuell eingetragen.",
    });
  }

  const priceDeviationItems = getCatalogPriceDeviationItems(order, services);
  const flatOverrideItems = getCatalogTextFlatOverrideItems(order, services);
  const priceReviewItems = uniqueCatalogReviewItems([
    ...priceDeviationItems,
    ...flatOverrideItems,
  ]).filter((item) => !isUnitMissingReviewItem(item));
  const catalogMissingItems = getCatalogMissingItems(order, services).filter(
    (item) =>
      !isUnitMissingServiceName(item.serviceName) &&
      !isUnitMissingReviewItem(item),
  );
  const hasPriceDeviationReview =
    (order.reviewReasons?.some((reason) =>
      reason.startsWith("price_override:"),
    ) ??
      false) ||
    priceDeviationItems.length > 0 ||
    flatOverrideItems.length > 0;

  if (hasPriceDeviationReview) {
    pushUniqueBadge(badges, {
      key: "price_deviation",
      label: "Preis abweichend",
      className:
        "bg-yellow-100 text-yellow-900 border border-yellow-400 shadow-sm ring-1 ring-yellow-200/70",
      tooltip:
        formatServiceReviewSummaryTooltip({
          priceItems: priceReviewItems,
          items: order.items || [],
          services,
          currency: order.currency,
        }) ||
        formatCatalogPriceDeviationTooltip(
          priceReviewItems,
          services,
          order.currency,
        ),
    });
  }

  if (catalogMissingItems.length > 0) {
    pushUniqueBadge(badges, {
      key: "catalog_missing",
      label: "Nicht im Katalog",
      className:
        "bg-yellow-100 text-yellow-900 border border-yellow-400 shadow-sm ring-1 ring-yellow-200/70",
      tooltip:
        formatServiceReviewSummaryTooltip({
          missingItems: catalogMissingItems,
          items: order.items || [],
          services,
          currency: order.currency,
        }) || formatCatalogMissingTooltip(catalogMissingItems, order.currency),
    });
  }

  const hasCustomerReview =
    hasRealCustomerReviewReason(order) ||
    isCustomerDataIncomplete(order.customer) ||
    hasMissingOrFallbackCustomerName(order.customer?.name);

  if (hasCustomerReview) {
    pushUniqueBadge(badges, {
      key: "customer_review",
      label: "Kunde prüfen",
      className: "bg-red-100 text-red-700 border border-red-300",
      icon: true,
      tooltip:
        "Blockiert Angebot/Rechnung: Kundendaten fehlen, sind unvollständig oder müssen gegen mögliche Duplikate geprüft werden.",
      focusTarget: "customer",
    });
  }

  const compactServiceReviewKeys = new Set([
    "unit_conflict",
    "manual_unit_confirmed",
    "price_deviation",
    "catalog_missing",
  ]);
  const compactServiceReviewBadges = badges.filter((badge) =>
    compactServiceReviewKeys.has(badge.key),
  );

  if (compactServiceReviewBadges.length > 0) {
    const reviewedPositionKeys = new Set<string>();
    const addReviewedPosition = (
      item: Pick<OrderItem, "serviceName" | "unit" | "unitPrice" | "quantity">,
    ) => {
      reviewedPositionKeys.add(
        [
          normalizeForMatch(canonicalServiceNameForOrderItem(item.serviceName)),
          normalizePriceUnitForCompare(item.unit),
          Number(item.unitPrice || 0).toFixed(4),
          Number(item.quantity || 0).toFixed(4),
        ].join("|"),
      );
    };

    manualUnitItems.forEach(addReviewedPosition);
    priceReviewItems.forEach(addReviewedPosition);
    catalogMissingItems.forEach(addReviewedPosition);
    unitConflictServices.forEach((value) => {
      const serviceKey = normalizeForMatch(
        canonicalServiceNameForOrderItem(value.split(":")[0]),
      );
      const matchingItems = (order.items || []).filter(
        (item) =>
          normalizeForMatch(canonicalServiceNameForOrderItem(item.serviceName)) ===
          serviceKey,
      );
      if (matchingItems.length > 0) matchingItems.forEach(addReviewedPosition);
      else if (serviceKey) reviewedPositionKeys.add(`${serviceKey}|unit-conflict`);
    });

    const unifiedServiceReview = buildUnifiedServiceReviewSummaryV17_90L61({
      items: order.items || [],
      services,
      currency: order.currency,
    });
    const serviceReviewCount =
      unifiedServiceReview.count > 0
        ? unifiedServiceReview.count
        : Math.max(reviewedPositionKeys.size, compactServiceReviewBadges.length);
    const serviceReviewTooltip =
      unifiedServiceReview.tooltip ||
      formatServiceReviewSummaryTooltip({
        unitConflictServices,
        manualUnitItems,
        priceItems: priceReviewItems,
        missingItems: catalogMissingItems,
        items: order.items || [],
        services,
        currency: order.currency,
      });
    const serviceReviewGroups = buildOrderServiceReviewGroupsV17_90L135G(
      order,
      services,
      false,
    );

    return [
      ...badges.filter((badge) => !compactServiceReviewKeys.has(badge.key)),
      {
        key: "service_review_summary",
        label: `Leistungen prüfen · ${serviceReviewCount}`,
        className:
          "bg-yellow-100 text-yellow-900 border border-yellow-400 shadow-sm ring-1 ring-yellow-200/70",
        tooltip: serviceReviewTooltip || "Leistungen prüfen.",
        serviceReviewGroups,
      },
    ];
  }

  return badges;
};

const detectAppointmentClarificationHint = (
  ...values: Array<string | null | undefined>
) => {
  const lines = values
    .filter(Boolean)
    .flatMap((value) => String(value).split(/\n+/g))
    .map((line) => compactText(line))
    .filter(Boolean);

  return (
    lines.find((line) => {
      const text = normalizeForMatch(line);
      if (!text) return false;

      const wantsSchedulingContact =
        /(?:termin|datum|zeitfenster|zeitpunkt).*(?:klaeren|klaren|abstimmen|abgestimmt|abstimmung|koordinieren|melden|kontaktieren|vereinbaren|ausmachen|besprechen|offen|vorschlag|vorschlaege|vorschläge|senden|schicken)|(?:melden|kontaktieren|anrufen|schreiben).*(?:termin|datum|zeitfenster|zeitpunkt)|(?:termin|datum|zeitfenster|zeitpunkt)\s+(?:ist\s+)?offen|(?:zwei|2)\s+(?:termin)?vorschlaege\s+senden|(?:zwei|2)\s+(?:termin)?vorschläge\s+senden/.test(
          text,
        );
      if (!wantsSchedulingContact) return false;

      // Fixed appointments stay normal violet appointment chips.
      const hasConcreteDateOrTime =
        /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/.test(line) ||
        /\b(?:heute|morgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/.test(
          text,
        ) ||
        /\b(?:vormittag|nachmittag|abend)\b/.test(text) ||
        /\b\d{1,2}(?::|\.)\d{2}\b/.test(line) ||
        /\b\d{1,2}\s*(?:uhr|h)\b/.test(text);

      return !hasConcreteDateOrTime;
    }) || null
  );
};

const extractCallbackTimeHint = (
  ...values: Array<string | null | undefined>
) => {
  const source = values
    .filter(Boolean)
    .join("\n")
    .split(/\n+/g)
    .map((line) => compactText(line))
    .filter(Boolean);

  for (const line of source) {
    const normalized = normalizeForMatch(line);
    const callbackMatch = normalized.match(CALLBACK_CONTACT_WORD_PATTERN);
    if (!callbackMatch) {
      continue;
    }

    const callbackIndex = callbackMatch.index || 0;
    let callbackLocal = line.slice(
      Math.max(0, callbackIndex - 70),
      Math.min(line.length, callbackIndex + 140),
    );
    const appointmentBoundary = callbackLocal.search(/\btermin\b/i);
    if (appointmentBoundary >= 0) {
      const callbackLocalKey = normalizeForMatch(callbackLocal);
      const localCallbackIndex = callbackLocalKey.search(CALLBACK_CONTACT_WORD_PATTERN);
      if (appointmentBoundary > localCallbackIndex) {
        callbackLocal = callbackLocal.slice(0, appointmentBoundary);
      } else {
        callbackLocal = callbackLocal.slice(appointmentBoundary + "Termin".length);
      }
    }

    const rangeMatch = callbackLocal.match(
      /(?:zwischen|von)\s*(\d{1,2})(?::|\.)(\d{2})\s*(?:uhr|h)?\s*(?:und|bis)\s*(\d{1,2})(?::|\.)(\d{2})\s*(?:uhr|h)?\b/i,
    );

    if (rangeMatch?.[1]) {
      const fromHour = rangeMatch[1].padStart(2, "0");
      const fromMinute = rangeMatch[2] || "00";
      const toHour = rangeMatch[3].padStart(2, "0");
      const toMinute = rangeMatch[4] || "00";
      return `${fromHour}:${fromMinute}–${toHour}:${toMinute}`;
    }

    const match = callbackLocal.match(
      /(?:erst\s+)?(?:ab|nach)\s*(\d{1,2})(?:[:.\s]+(\d{2}))?\s*(?:uhr|h)?\b/i,
    );

    if (match?.[1]) {
      const hour = match[1].padStart(2, "0");
      const minute = match[2] || "00";
      return `erst ab ${hour}:${minute}`;
    }

    const notBeforeMatch = callbackLocal.match(
      /(?:nicht\s+vor|nicht\s+vorher\s+als|fr[uü]hestens)\s*(\d{1,2})(?:[:.\s]+(\d{2}))?\s*(?:uhr|h)?\b/i,
    );

    if (notBeforeMatch?.[1]) {
      const hour = notBeforeMatch[1].padStart(2, "0");
      const minute = notBeforeMatch[2] || "00";
      return `erst ab ${hour}:${minute}`;
    }
  }

  return "";
};

const isCallbackTimeLine = (value?: string | null) => {
  return isAppointmentContactTimeLine(value);
};

const detectPreArrivalInstructionHint = (
  ...values: Array<string | null | undefined>
) => {
  const lines = values
    .filter(Boolean)
    .join("\n")
    .split(/\n+/g)
    .map((line) => compactText(stripVisibleNoteMarkerV17_35(line)))
    .filter(Boolean);

  const direct = lines.find((line) => {
    const text = normalizeForMatch(line);
    if (!text) return false;
    return isPreArrivalInstructionLine(line);
  });

  if (!direct) return null;

  const callbackTime = extractCallbackTimeHint(...values);
  const cleanedDirect = compactText(stripVisibleNoteMarkerV17_35(direct))
    .replace(
      /\b(?:keine?|kein|ohne|nicht)\s+(?:per\s+|via\s+)?whats\s*app\.?/gi,
      "",
    )
    .replace(
      /[;,.]?\s*(?:bitte\s+)?(?:nicht|nid|ned|noed|nöd)\s+einfach\s+(?:kommen|vorbeikommen|cho|verbi\s+cho)\.?/gi,
      "",
    )
    .replace(
      /^(?:bitte\s+)?(?:nicht|nid|ned|noed|nöd)\s+einfach\s+(?:kommen|vorbeikommen|cho|verbi\s+cho)\.?$/gi,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[;,.]\s*$/g, "")
    .trim();

  let detailLine =
    cleanedDirect && normalizeForMatch(cleanedDirect) !== "nicht einfach kommen"
      ? cleanedDirect
      : "Vorher melden, nicht direkt erscheinen.";

  if (/^\s*[,;:.\-–—]+\s*/.test(detailLine)) {
    detailLine = detailLine.replace(/^\s*[,;:.\-–—]+\s*/, "").trim();
  }

  if (!detailLine || normalizeForMatch(detailLine) === "nicht einfach kommen") {
    detailLine = "Vorher melden, nicht direkt erscheinen.";
  }

  return [detailLine, callbackTime ? `Zeit: ${callbackTime}` : ""]
    .filter(Boolean)
    .join("\n");
};

const isEmailOnlyContactInstructionLine = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text) return false;

  return (
    /(?:nur|ausschliesslich|ausschließlich|exklusiv|only|exclusively|uniquement|solo|solamente)\s+(?:kontakt\s+)?(?:per\s+|via\s+|ueber\s+|uber\s+)?(?:e\s*mail|e-mail|email|mail)/.test(
      text,
    ) ||
    /(?:e\s*mail|email|mail)\s+(?:reicht|only|uniquement)/.test(text) ||
    /kontakt\s+nur\s+(?:per\s+)?(?:e\s*mail|email|mail)/.test(text) ||
    /contact\s+us\s+by\s+email\s+only/.test(text)
  );
};

const shouldSuppressCallbackBecauseEmailOnly = (lines: string[]) => {
  const hasEmailOnly = lines.some((line) =>
    isEmailOnlyContactInstructionLine(line),
  );
  if (!hasEmailOnly) return false;

  const hasRealPhoneCallback = lines.some((line) => {
    const text = normalizeForMatch(line);
    if (!text) return false;
    if (isEmailOnlyContactInstructionLine(line)) return false;
    return /(?:rueckruf|ruckruf|zurueckrufen|zuruckrufen|anrufen|telefonisch\s+melden|telefonisch\s+kontaktieren|call\s+back|phone\s+call|please\s+call|call\s+us)/.test(
      text,
    );
  });

  return !hasRealPhoneCallback;
};

const getBottomBadges = (
  order: Order,
  parsedNotes: ReturnType<typeof splitSpecialNotes>,
): ReviewBadge[] => {
  const badges: ReviewBadge[] = [];
  const canonicalSnapshotV2 = getCanonicalIntakeV2(order);
  if (canonicalSnapshotV2) {
    const communication = canonicalCommunicationDataV2(canonicalSnapshotV2);
    if (communication.channel === "call") {
      pushUniqueBadge(badges, {
        key: "callback_request",
        label: "Anrufen",
        className: "bg-blue-100 text-blue-700 border border-blue-400 shadow-sm",
        tooltip: communication.targetPhone
          ? `Anrufen: ${communication.targetPhone}`
          : "Telefonisch melden",
      });
    }
    const appointment = canonicalAppointmentBadgeV2(canonicalSnapshotV2);
    if (appointment) {
      pushUniqueBadge(badges, {
        key: "appointment",
        label: appointment.label,
        className: "bg-violet-100 text-violet-700 border border-violet-300",
        tooltip: appointment.tooltip,
      });
    }
    return badges;
  }
  if (isIntakeV2Order(order)) {
    return [{
      key: "canonical_intake_v2_invalid",
      label: "Intake prüfen",
      className: "bg-red-100 text-red-700 border border-red-400",
      tooltip: "Versiegelter Intake-Snapshot ungültig; keine Legacy-Auswertung ausgeführt.",
    }];
  }
  const blueClass = "bg-blue-100 text-blue-700 border border-blue-300";

  const callbackSource = [
    order.specialNotes,
    order.notes,
    order.audioTranscript,
    ...parsedNotes.jobHints,
  ]
    .filter(Boolean)
    .join("\n");

  const callbackLinesForDetection = [
    order.specialNotes,
    order.notes,
    order.audioTranscript,
    ...parsedNotes.jobHints,
  ]
    .filter(Boolean)
    .flatMap((part) => String(part).split(/\n+|(?<=[.!?])\s+/g))
    .map((line) => line.trim())
    .filter(Boolean);

  const directCallbackHint = callbackLinesForDetection.find((line) =>
    isPositiveCallbackChipLine(line),
  );

  const suppressCallbackBecauseEmailOnly =
    shouldSuppressCallbackBecauseEmailOnly(callbackLinesForDetection);

  // V17.52: Kanal-Zeilen wie "Kontakt nur per SMS an ..." oder
  // "WhatsApp vorher an ..." sind keine Rückruf-/Telefonbitte. Rückruf bleibt
  // nur bei echter Telefon-/Rückruf-Anweisung aktiv.
  const callbackDetectionSource = callbackLinesForDetection
    .filter((line) => !isChannelOnlyContactLineForCommunicationChips(line))
    .join("\n");

  const hasCallbackBadge = Boolean(
    !suppressCallbackBecauseEmailOnly &&
    (directCallbackHint || detectCallbackRequest(callbackDetectionSource)),
  );
  const callbackTimeHint = hasCallbackBadge
    ? extractCallbackTimeHint(
        order.specialNotes,
        order.notes,
        order.audioTranscript,
        ...parsedNotes.jobHints,
      )
    : "";

  const preArrivalHint = detectPreArrivalInstructionHint(
    order.specialNotes,
    order.notes,
    order.audioTranscript,
    ...parsedNotes.jobHints,
  );
  if (preArrivalHint && !hasCallbackBadge) {
    pushUniqueBadge(badges, {
      key: "pre_arrival_instruction",
      label: "Nicht einfach kommen",
      className: "bg-blue-100 text-blue-700 border border-blue-300",
      tooltip: preArrivalHint,
      focusTarget: "specialNotes",
    });
  }

  // Zusammengeführt wird oben bei den Systemchips neben der Ausführungsadresse angezeigt.
  // Wenn ein Merge mehrere Telefonnummern, Kontaktwege oder Termine enthält,
  // zeigen wir außen nicht Mail/WhatsApp/SMS/Rückruf/Termin einzeln.
  // Stattdessen steht dieser Sammelchip in der Kontaktchip-Zeile und springt
  // direkt zu den gruppierten Besonderheiten.
  if (hasMergedMultipleContactData(order, parsedNotes)) {
    pushUniqueBadge(badges, {
      key: "merged_data_review",
      label: "Mehrere Daten prüfen",
      className: "bg-emerald-100 text-emerald-800 border border-emerald-300",
      tooltip: formatMergedContactReviewTooltip([order as any]),
      focusTarget: "specialNotes",
    });
  }

  if (hasCallbackBadge) {
    const callbackLines = [
      order.specialNotes,
      order.notes,
      order.audioTranscript,
      ...parsedNotes.jobHints,
    ]
      .filter(Boolean)
      .flatMap((part) => String(part).split(/\n+/g))
      .map((line) => compactText(line))
      .filter(Boolean);
    const hasNegativeWhatsApp = callbackLines.some((line) =>
      isNegativeWhatsAppInstructionLine(line),
    );
    const hasPreArrivalInstruction = Boolean(preArrivalHint);
    const callbackTooltip = [
      callbackTimeHint ? `Rückruf ${callbackTimeHint}` : "Rückruf gewünscht",
      hasPreArrivalInstruction ? "Vorher telefonisch melden" : "",
      hasNegativeWhatsApp ? "Keine WhatsApp" : "",
    ]
      .filter(Boolean)
      .join(" · ");

    pushUniqueBadge(badges, {
      key: "callback_request",
      label: callbackTimeHint ? `Rückruf ${callbackTimeHint}` : "Rückruf",
      className: "bg-blue-100 text-blue-700 border border-blue-400 shadow-sm",
      tooltip: callbackTooltip,
    });
  }

  // Communication chips (Mail/SMS/WhatsApp) are rendered by CommunicationChips only.
  // Do not add an extra SMS review badge here; otherwise SMS appears twice.

  // V17.90L179: Auftrag, Angebot und Rechnung verwenden dieselbe
  // read-only Terminquelle. Datumswerte werden nie als Uhrzeiten interpretiert
  // und jeder Termin bleibt dem Arbeitsort aus seiner Quellsektion zugeordnet.
  const unifiedAppointmentEntries = collectMergedAppointmentEntries([
    order as any,
  ]);

  if (unifiedAppointmentEntries.length > 0) {
    pushUniqueBadge(badges, {
      key:
        unifiedAppointmentEntries.length > 1
          ? "appointments_multiple"
          : "appointment",
      label: formatMergedAppointmentChipLabel(unifiedAppointmentEntries),
      className: "bg-violet-100 text-violet-700 border border-violet-300",
      tooltip: formatMergedAppointmentTooltip(unifiedAppointmentEntries),
    });
  } else {
    const appointmentClarification = detectAppointmentClarificationHint(
      ...parsedNotes.jobHints,
      order.specialNotes,
      order.notes,
      order.audioTranscript,
    );

    if (appointmentClarification) {
      pushUniqueBadge(badges, {
        key: "appointment_clarify",
        label: "Termin klären",
        className: "bg-amber-100 text-amber-800 border border-amber-300",
        tooltip: compactText(appointmentClarification).slice(0, 120),
        focusTarget: "specialNotes",
      });
    }
  }

  return badges;
};

const isPositiveCallbackChipLine = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text) return false;

  const negative =
    /kein(?:e[nm]?)?\s+(?:telefonischer\s+)?(?:rueckruf|ruckruf|anruf)|nicht\s+(?:telefonisch\s+)?(?:zurueckrufen|zuruckrufen|anrufen)|(?:rueckruf|ruckruf)\s+(?:nicht\s+)?(?:noetig|notig|erwuenscht)/.test(
      text,
    );

  if (negative) return false;

  if (
    CALLBACK_CONTACT_WORD_PATTERN.test(text) &&
    CALLBACK_TIME_PATTERN.test(text)
  )
    return true;

  return /(?:rueckruf|ruckruf)\s+(?:gewuenscht|erwuenscht|bitte|vor|arbeitsbeginn|ankunft)|bitte\s+(?:kurz\s+)?(?:zurueckrufen|zuruckrufen|anrufen|aaluete|anluete|klingeln)|vorher\s+(?:kurz\s+)?(?:anrufen|telefonieren|kontaktieren|zurueckrufen|zuruckrufen|aaluete|anluete|klingeln)|vor\s+ankunft\s+(?:kurz\s+)?(?:zurueckrufen|zuruckrufen|anrufen|telefonieren|kontaktieren)|vor\s+arbeitsbeginn\s+(?:kurz\s+)?(?:telefonisch\s+)?(?:kontaktieren|melden|anrufen|telefonieren|aaluete|anluete|klingeln)|vor\s+ort\s+(?:kurz\s+)?(?:anrufen|telefonieren|kontaktieren|zurueckrufen|zuruckrufen)|telefonischer\s+(?:rueckruf|ruckruf)|telefonisch\s+(?:abklaeren|kontaktieren|melden)|\b\d+\s*minuten\s+(?:vorher|vor\s+arbeitsbeginn|vor\s+ankunft)\s+(?:anrufen|telefonieren|kontaktieren|zurueckrufen|zuruckrufen)/.test(
    text,
  );
};

const COMMUNICATION_CHIP_PHONE_NUMBER_PATTERN = /\+?\d[\d\s()./-]{6,}\d/g;

const isChannelOnlyContactLineForCommunicationChips = (
  value?: string | null,
) => {
  const text = normalizeForMatch(value);
  if (!text || isPositiveCallbackChipLine(value)) return false;

  const mentionsChannel =
    /\b(?:sms|whats\s*app|whatsapp|e\s*mail|email|mail)\b/.test(text);
  if (!mentionsChannel) return false;

  const saysChannelOnlyOrPreferred =
    /\b(?:nur|only|uniquement|solo|solamente)\b.{0,28}\b(?:sms|whats\s*app|whatsapp|e\s*mail|email|mail)\b/.test(
      text,
    ) ||
    /\b(?:kontakt|contact)\b.{0,28}\b(?:sms|whats\s*app|whatsapp|e\s*mail|email|mail)\b/.test(
      text,
    ) ||
    /\b(?:sms|whats\s*app|whatsapp|e\s*mail|email|mail)\b.{0,32}\b(?:bevorzugt|reicht|preferred|only)\b/.test(
      text,
    ) ||
    /\b(?:vorher|zuerst|erst)\b.{0,24}\b(?:sms|whats\s*app|whatsapp|schreiben|message|nachricht)\b/.test(
      text,
    );

  const forbidsPhone =
    /\b(?:nicht|keine?|kein|ohne|no|not|without)\b.{0,32}\b(?:telefon|anruf|anrufen|rueckruf|ruckruf|zurueckrufen|zuruckrufen|call)\b/.test(
      text,
    ) ||
    /\b(?:telefon|anruf|anrufen|rueckruf|ruckruf|zurueckrufen|zuruckrufen|call)\b.{0,32}\b(?:nicht|keine?|kein|ohne|no|not|without)\b/.test(
      text,
    );

  return saysChannelOnlyOrPreferred || forbidsPhone;
};

const sanitizeCommunicationChipLineForCommunicationChips = (line: string) => {
  if (!isChannelOnlyContactLineForCommunicationChips(line)) return line;

  // A structured on-site contact line is the authoritative action target.
  // Never remove its phone merely because it also contains "nur SMS" or
  // "nur WhatsApp"; otherwise the chip falls back to the office number.
  if (
    /^\s*(?:\[(?:HINWEIS|INFO|NOTIZ)\]\s*)?Kontakt\s+vor\s+Ort\s*:/i.test(
      line,
    )
  ) {
    return line;
  }

  // V17.90L81: A whole WhatsApp order can arrive as one long line. Removing
  // every phone number from that mixed line also removes the explicit on-site
  // contact and forces the chip back to the billing-office number. Only strip
  // numbers from genuinely short, channel-only instructions.
  const normalized = normalizeForMatch(line);
  const mixedOperationalSignals = [
    /\brechnung\b/.test(normalized),
    /\b(?:arbeit|arbeitsort|chantier|einsatzort)\b/.test(normalized),
    /\b(?:leistung|reinigen|montieren|ersetzen|pruefen|service)\b/.test(normalized),
    /\b(?:termin|schluessel|schlussel|code|parkplatz)\b/.test(normalized),
  ].filter(Boolean).length;
  if (line.length > 180 && mixedOperationalSignals >= 2) return line;

  return compactText(
    line
      .replace(COMMUNICATION_CHIP_PHONE_NUMBER_PATTERN, "")
      .replace(
        /\ban\s+(?=schreiben|senden|melden|kontaktieren|message|nachricht)/i,
        "",
      )
      .replace(/\b(?:an|unter|auf|via)\s*[.,;:!?-]*$/i, "")
      .replace(/\s{2,}/g, " "),
  );
};

const removeCallbackLinesForCommunicationChips = (value?: string | null) =>
  String(value || "")
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter((line) => line && !isPositiveCallbackChipLine(line))
    .map((line) => sanitizeCommunicationChipLineForCommunicationChips(line))
    .filter(Boolean)
    .join("\n");

const cleanCommunicationCardClauseV17_90L123 = (
  value?: string | null,
) =>
  compactText(value)
    .replace(
      /^\s*\[(?:HINWEIS|INFO|NOTIZ|GEFAHR|WARNUNG|WARNHINWEIS)\]\s*/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

const buildCompactCommunicationContextV17_90L123 = (
  order: Order,
): string => {
  const source = [
    removeCallbackLinesForCommunicationChips(order.specialNotes),
    removeCallbackLinesForCommunicationChips(order.notes),
    removeCallbackLinesForCommunicationChips(order.audioTranscript),
  ]
    .filter(Boolean)
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  if (!source.trim()) return "";

  const clauses = source
    .replace(
      /\s*(?=\[(?:HINWEIS|INFO|NOTIZ|GEFAHR|WARNUNG|WARNHINWEIS)\]\s*)/gi,
      "\n",
    )
    .split(/\n+/g)
    .map((line) => cleanCommunicationCardClauseV17_90L123(line))
    .filter(Boolean);

  const hasCommunicationChannel = (value?: string | null) =>
    /\b(?:whats\s*app|whatsapp|sms|e\s*mail|e-mail|email|mail|courriel)\b/i.test(
      String(value || ""),
    );

  // Eine ausdrückliche Nur-E-Mail-Anweisung hat Vorrang vor allen
  // gleichzeitig verneinten Kanälen (z. B. „kein WhatsApp“). Dadurch kann
  // eine Negation niemals mehr einen WhatsApp-/SMS-Chip erzeugen.
  const emailOnlyClause = clauses.find((line) =>
    isEmailOnlyContactInstructionLine(line),
  ) || (/(?:nur|ausschließlich|ausschliesslich|exklusiv|only|exclusively|uniquement)\s+(?:kontakt\s+)?(?:per\s+|via\s+|über\s+|ueber\s+)?(?:e\s*mail|e-mail|email|mail)/i.test(source)
    ? "nur E-Mail"
    : "");
  if (emailOnlyClause) {
    const email = extractOrderContactEmailForCustomerDisplayV17_90K(order);
    return `Kontakt vor Ort: ${email ? `${email} · ` : ""}nur E-Mail · nicht telefonisch`;
  }

  const structuredContact = clauses.find(
    (line) =>
      /^Kontakt\s+vor\s+Ort\s*:/i.test(line) &&
      hasCommunicationChannel(line),
  );
  if (structuredContact) return structuredContact;

  const extractedContact = cleanCommunicationCardClauseV17_90L123(
    extractOrderOperationalContactLineV17_90L101(
      order.specialNotes,
      order.notes,
      order.audioTranscript,
    ),
  );
  if (extractedContact && hasCommunicationChannel(extractedContact)) {
    return extractedContact;
  }

  const channelClause = clauses.find(
    (line) =>
      hasCommunicationChannel(line) &&
      isChannelOnlyContactLineForCommunicationChips(line),
  );
  if (!channelClause) return "";

  const phone =
    extractOperationalPhoneForHrefV17_90L85(
      order.specialNotes,
      order.notes,
      order.audioTranscript,
    ) || "";
  const email = extractOrderContactEmailForCustomerDisplayV17_90K(order);
  const name = phone
    ? extractContactNameBeforePhoneV17_90L113(channelClause, phone)
    : "";
  const parts = [name];

  if (/\b(?:whats\s*app|whatsapp)\b/i.test(channelClause)) {
    if (phone) parts.push(phone);
    parts.push("nur WhatsApp");
  } else if (/\bsms\b/i.test(channelClause)) {
    if (phone) parts.push(phone);
    parts.push("nur SMS");
  } else if (/\b(?:e\s*mail|e-mail|email|mail|courriel)\b/i.test(channelClause)) {
    if (email) parts.push(email);
    parts.push("nur E-Mail");
  }

  if (
    /\b(?:nicht\s+telefonisch|nicht\s+(?:im\s+büro\s+)?anrufen|kein\s+anruf|do\s+not\s+call|don['’]?t\s+call|no\s+calls?)\b/i.test(
      channelClause,
    )
  ) {
    parts.push("nicht telefonisch");
  }

  const compactParts = parts.filter(Boolean);
  return compactParts.length > 0
    ? `Kontakt vor Ort: ${compactParts.join(" · ")}`
    : "";
};

const buildCommunicationChipDataV17_52 = (order: Order): any => {
  const canonicalSnapshotV2 = getCanonicalIntakeV2(order);
  if (canonicalSnapshotV2) {
    const communication = canonicalCommunicationDataV2(canonicalSnapshotV2);
    const explicitContact = extractDocumentContactFallback(
      order.notes,
      order.audioTranscript,
      order.specialNotes,
    );
    const targetPhone =
      communication.targetPhone || explicitContact.phone || "";
    const targetEmail =
      communication.targetEmail || explicitContact.email || "";
    const communicationContext =
      explicitContact.title || communication.communicationContext || "";
    return {
      ...order,
      phone: targetPhone,
      customerPhone: canonicalSnapshotV2.customer.phone || "",
      contactPhone: targetPhone,
      email: targetEmail,
      customer: order.customer
        ? {
            ...order.customer,
            phone: canonicalSnapshotV2.customer.phone,
            email: canonicalSnapshotV2.customer.email,
          }
        : order.customer,
      specialNotes: "",
      communicationContext:
        communication.channel === "call" ? "" : communicationContext,
      notes: communication.channel === "call" ? "" : communicationContext,
      audioTranscript: "",
    };
  }
  if (isIntakeV2Order(order)) {
    return {
      ...order,
      phone: "",
      customerPhone: "",
      contactPhone: "",
      email: "",
      specialNotes: "",
      communicationContext: "",
      notes: "",
      audioTranscript: "",
    };
  }
  const compactCommunicationContext =
    buildCompactCommunicationContextV17_90L123(order);
  const rawCommunicationSource = [
    order.specialNotes,
    order.notes,
    order.audioTranscript,
  ]
    .filter(Boolean)
    .join("\n");
  const resolvedEmail =
    extractOrderContactEmailForCustomerDisplayV17_90K(order) ||
    (order as any).email ||
    order.customer?.email ||
    "";
  const hasExplicitEmailOnlyInstruction =
    /\b(?:kontakt\s+)?(?:ausschließlich|ausschliesslich|exklusiv|nur|only|exclusively)\b.{0,40}\b(?:per\s+|via\s+|über\s+|ueber\s+)?(?:e\s*mail|e-mail|email|mail)\b|\b(?:e\s*mail|e-mail|email|mail)\b.{0,40}\b(?:ausschließlich|ausschliesslich|exklusiv|nur|only|exclusively)\b/i.test(
      rawCommunicationSource,
    );
  const canonicalCommunicationContext = hasExplicitEmailOnlyInstruction
    ? `Kontakt ausschließlich per E-Mail${resolvedEmail ? `: ${resolvedEmail}` : ""}`
    : compactCommunicationContext;

  // V17.90k: Keep stored customer contact data available for SMS/WhatsApp/Mail
  // chip targets. The communication component only creates channel chips from
  // explicit communication intent; a stored phone number alone must not create a
  // generic phone chip. This keeps chips clickable when a later message says
  // "Bitte SMS/WhatsApp" without repeating the number.
  return {
    ...order,
    phone: (order as any).phone || order.customer?.phone || "",
    customerPhone: order.customer?.phone || "",
    contactPhone:
      extractOperationalPhoneForHrefV17_90L85(
        order.specialNotes,
        order.notes,
        order.audioTranscript,
      ) || order.customer?.phone || "",
    email: resolvedEmail,
    customer: order.customer
      ? { ...order.customer }
      : order.customer,
    // Card-level operational chips are rendered by getOperationalBadges below.
    // Keep specialNotes out of hazard/equipment rendering, but pass the canonical
    // structured contact line separately so SMS/WhatsApp/Mail chips use the
    // verified on-site target instead of the billing-office contact.
    specialNotes: "",
    // V17.90L123: Card communication chips receive only the canonical contact
    // instruction. Never pass the full customer message or all [HINWEIS]
    // content into a WhatsApp/SMS tooltip.
    communicationContext: canonicalCommunicationContext,
    notes: canonicalCommunicationContext,
    audioTranscript: "",
  };
};

const extractOrderContactPhoneForCustomerDisplayV17_90K = (order?: Order | null) => {
  const source = [order?.notes, order?.specialNotes, order?.audioTranscript]
    .filter(Boolean)
    .join("\n");
  const match = source.match(
    /(?:tel\.?|telefon|phone|mobile|handy|natel|whats\s*app(?:\s+nummer)?|sms|kontakt(?:\s+vor\s+ort)?|anrufen|rückruf|rueckruf)\s*[:.]?\s*(\+?\d[\d\s()./-]{6,}\d)/i,
  ) || source.match(/(\+\d[\d\s()./-]{7,}\d)/);
  return match?.[1]?.replace(/\s+/g, " ").trim() || "";
};

const extractOrderContactEmailForCustomerDisplayV17_90K = (order?: Order | null) => {
  const source = [order?.notes, order?.specialNotes, order?.audioTranscript]
    .filter(Boolean)
    .join("\n");
  return source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.trim() || "";
};

const getStrongerCardBadgeClassName = (className?: string | null) =>
  String(className || "")
    .replace(/\bborder\s+border-/g, "border-2 border-")
    .replace(/\bborder\s+border\b/g, "border-2 border");

const compactIconForBadge = (
  badge: ReviewBadge,
): ComponentType<{ className?: string }> | null => {
  // V17.90L: Ausführungsadressen bleiben als kompakte Orts-/Textchips sichtbar.
  // Sie dürfen aber nicht mehr durch die allgemeine Zugangs-/Tür-Erkennung in
  // einen Tür-/Zugangschip umgewandelt werden, weil das wie ein separater
  // Zugangshinweis aussieht und falsche Tooltips erzeugen kann.
  if (badge.key === "site_address") return null;
  if (badge.key === "special_notes_summary") return Info;

  const label = normalizeForMatch(badge.label);
  if (label.includes("hund")) {
    return DangerousDogIcon;
  }
  if (label.includes("leiter")) return LadderIcon;
  if (label.includes("schluessel") || label.includes("schlussel"))
    return KeyRound;
  if (
    label === "zugang" ||
    label.includes("zugang") ||
    label.includes("seiteneingang") ||
    label.includes("hintereingang")
  )
    return OpenDoorIcon;
  // Generic red danger chips such as "Achtung" use only the warning symbol,
  // matching the compact presentation already used on offers/mobile.
  if (badge.icon && badge.focusTarget === "specialNotes") return WarningEmojiIcon;
  return null;
};

const compactSymbolForBadge = (badge: ReviewBadge): string | null => {
  const label = normalizeForMatch(badge.label);
  if (badge.key.includes("parking") && label === "parken") return "P";
  return null;
};


const renderSpecialNotesSummaryTooltipV17_91 = (
  badge: ReviewBadge,
  align: "left" | "right" = "left",
  forceVisible = false,
) => {
  const tooltip = cleanVisibleTooltipTextV17_35(badge.tooltip);
  if (!tooltip) return null;
  const alignClass = align === "right" ? "right-0" : "left-0";
  const sections = splitSpecialNotesSummaryTooltipV17_91(tooltip);
  const hasSafety = sections.safety.length > 0;
  const hasPrimary = sections.primary.length > 0;
  const hasHints = sections.hints.length > 0;
  if (!hasSafety && !hasPrimary && !hasHints) return null;

  return (
    <span
      className={`pointer-events-none absolute ${alignClass} bottom-full z-[9999] mb-1 w-[min(24rem,calc(100vw-2rem))] max-h-[55vh] overflow-auto rounded-xl border border-slate-200 bg-white p-2 text-left text-[11px] font-medium leading-snug text-slate-800 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${forceVisible ? "block" : "hidden group-hover:block group-focus:block"}`}
    >
      {hasSafety && (
        <span className="mb-2 block rounded-lg border border-red-300 bg-red-50 p-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-100">
          <span className="mb-1 flex items-center gap-1 font-bold">
            <AlertTriangle className="h-3.5 w-3.5" /> Gefahr / Achtung
          </span>
          {sections.safety.map((line, index) => (
            <span key={`summary_safety_${index}`} className="block whitespace-pre-wrap break-words">
              • {line}
            </span>
          ))}
        </span>
      )}

      {hasPrimary && (
        <span className="mb-2 block rounded-lg border border-blue-300 bg-blue-50 p-2 text-blue-900 dark:border-blue-800/70 dark:bg-blue-950/30 dark:text-blue-100">
          <span className="mb-1 flex items-center gap-1 font-bold"><Info className="h-3.5 w-3.5" /> Wichtige Informationen</span>
          {sections.primary.map((line, index) => (
            <span key={`summary_primary_${index}`} className="block whitespace-pre-wrap break-words">{line}</span>
          ))}
        </span>
      )}

      {hasHints && (
        <span className="block rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-100">
          <span className="mb-1 block font-bold">Weitere Besonderheiten</span>
          {sections.hints.map((line, index) => (
            <span key={`summary_hint_${index}`} className="block whitespace-pre-wrap break-words">
              {line}
            </span>
          ))}
        </span>
      )}
    </span>
  );
};

const renderExecutionAddressBadgeTooltipV17_90L56 = (
  badge: ReviewBadge,
  align: "left" | "right" = "left",
  forceVisible = false,
  mobile = false,
) => {
  const tooltip = cleanVisibleTooltipTextV17_35(badge.tooltip);
  if (!tooltip) return null;
  const lines = tooltip.split("\n");
  const heading = lines.shift() || "Ausführungsadresse";
  const alignClass = align === "right" ? "right-0" : "left-0";
  const positionClass = mobile
    ? "pointer-events-auto fixed top-1/2 left-4 right-4 z-[10000] max-h-[62vh] -translate-y-1/2 overflow-y-auto"
    : `pointer-events-none absolute ${alignClass} bottom-full z-[9999] mb-1 max-h-[55vh] overflow-y-auto`;
  const visibilityClass = forceVisible
    ? "block"
    : mobile
      ? "hidden group-focus:block group-hover:block"
      : "hidden group-hover:block group-focus:block";

  return (
    <span
      className={`${positionClass} ${visibilityClass} w-[min(25rem,calc(100vw-2rem))] rounded-xl border border-sky-200 bg-white p-3 text-left text-[11px] font-medium leading-snug text-slate-800 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100`}
    >
      <span className="mb-2 flex items-center gap-1.5 font-bold text-sky-800 dark:text-sky-200">
        <MapPin className="h-3.5 w-3.5" /> {heading}
      </span>
      <span className="block space-y-1">
        {lines.map((line, index) => {
          const trimmed = line.trim();
          if (!trimmed) return null;
          if (/^[-─—–_]{3,}$/.test(trimmed)) {
            return (
              <span
                key={`execution_address_separator_${index}`}
                className="my-2 block border-t border-sky-100 dark:border-slate-700"
              />
            );
          }
          if (/^Arbeitsort\s+\d+/i.test(trimmed)) {
            return (
              <span
                key={`execution_address_site_${index}`}
                className="mt-2 block font-bold text-slate-950 dark:text-slate-50"
              >
                {trimmed}
              </span>
            );
          }
          const match = trimmed.match(/^(Objekt|Strasse|PLZ \/ Ort|Hinweis):\s*(.*)$/i);
          if (match) {
            return (
              <span
                key={`execution_address_line_${index}`}
                className="grid grid-cols-[72px_1fr] gap-x-2"
              >
                <span className="text-muted-foreground">{match[1]}:</span>
                <span
                  className={`break-words ${/^Objekt$/i.test(match[1]) ? "font-semibold text-slate-950 dark:text-slate-50" : ""}`}
                >
                  {match[2] || "–"}
                </span>
              </span>
            );
          }
          return (
            <span key={`execution_address_text_${index}`} className="block break-words">
              {trimmed}
            </span>
          );
        })}
      </span>
    </span>
  );
};


const renderExecutionAddressTooltipContentV17_95 = (tooltip: string) => {
  const lines = cleanVisibleTooltipTextV17_35(tooltip).split("\n");
  const heading = lines.shift() || "Ausführungsadresse";

  return (
    <>
      <span className="mb-2 flex items-center gap-1.5 text-sm font-bold text-sky-800 dark:text-sky-200">
        <MapPin className="h-4 w-4" /> {heading}
      </span>
      <span className="block space-y-1.5">
        {lines.map((line, index) => {
          const trimmed = line.trim();
          if (!trimmed) return null;
          if (/^[-─—–_]{3,}$/.test(trimmed)) {
            return (
              <span
                key={`execution_address_viewport_separator_${index}`}
                className="my-2 block border-t border-sky-100 dark:border-slate-700"
              />
            );
          }
          if (/^Arbeitsort\s+\d+/i.test(trimmed)) {
            return (
              <span
                key={`execution_address_viewport_site_${index}`}
                className="mt-2 block font-bold text-slate-950 dark:text-slate-50"
              >
                {trimmed}
              </span>
            );
          }
          const match = trimmed.match(
            /^(Objekt|Strasse|PLZ \/ Ort|Hinweis):\s*(.*)$/i,
          );
          if (match) {
            const isObject = /^Objekt$/i.test(match[1]);
            return (
              <span
                key={`execution_address_viewport_line_${index}`}
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
              </span>
            );
          }
          return (
            <span
              key={`execution_address_viewport_text_${index}`}
              className="block break-words"
            >
              {trimmed}
            </span>
          );
        })}
      </span>
    </>
  );
};

const renderOrderSpecialNotesTooltipContentV17_95 = (tooltip: string) => {
  const sections = splitSpecialNotesSummaryTooltipV17_91(tooltip);
  return (
    <span className="block space-y-2">
      {sections.safety.length > 0 && (
        <span className="block rounded-lg border border-red-300 bg-red-50 p-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-100">
          <span className="mb-1 flex items-center gap-1 font-bold">
            <AlertTriangle className="h-3.5 w-3.5" /> Gefahr / Achtung
          </span>
          {sections.safety.map((line, index) => (
            <span
              key={`viewport_summary_safety_${index}`}
              className="block whitespace-pre-wrap break-words"
            >
              • {line}
            </span>
          ))}
        </span>
      )}
      {sections.primary.length > 0 && (
        <span className="block rounded-lg border border-blue-300 bg-blue-50 p-2 text-blue-900 dark:border-blue-800/70 dark:bg-blue-950/30 dark:text-blue-100">
          <span className="mb-1 flex items-center gap-1 font-bold">
            <Info className="h-3.5 w-3.5" /> Wichtige Informationen
          </span>
          {sections.primary.map((line, index) => (
            <span
              key={`viewport_summary_primary_${index}`}
              className="block whitespace-pre-wrap break-words"
            >
              {line}
            </span>
          ))}
        </span>
      )}
      {sections.hints.length > 0 && (
        <span className="block rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-100">
          <span className="mb-1 block font-bold">Weitere Besonderheiten</span>
          {sections.hints.map((line, index) => (
            <span
              key={`viewport_summary_hint_${index}`}
              className="block whitespace-pre-wrap break-words"
            >
              {line}
            </span>
          ))}
        </span>
      )}
    </span>
  );
};

const ViewportAwareOrderBadgeTooltipV17_95 = ({
  badge,
  align = "left",
}: {
  badge: ReviewBadge;
  align?: "left" | "right";
}) => {
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
  const tooltip = cleanVisibleTooltipTextV17_35(badge.tooltip);

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
    // V17.90L113: Callback uses the exact same proven viewport-aware
    // positioning as key/access and all other compact icon chips. No custom
    // width or forced direction, because that detached the text from the chip.
    const preferredWidth =
      badge.key === "site_address" || badge.key === "special_notes_summary"
        ? 400
        : 352;
    const minimumWidth = 240;
    const width = Math.max(
      minimumWidth,
      Math.min(preferredWidth, window.innerWidth - viewportPadding * 2),
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
    const desiredHeight =
      badge.key === "site_address" || badge.key === "special_notes_summary"
        ? 400
        : 320;
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
    window.dispatchEvent(
      new Event(SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227),
    );
    if (badge.key !== "site_address") {
      window.dispatchEvent(
        new Event("smartflow:close-execution-address-popovers"),
      );
    }
  };

  const openTooltipImmediately = () => {
    closeOtherPopovers();
    clearOpenTimer();
    clearHideTimer();
    const nextPosition = calculatePosition();
    if (nextPosition) setPosition(nextPosition);
    setOpen(true);
  };
  const openTooltipByClick = () => {
    if (open) {
      clearOpenTimer();
      clearHideTimer();
      clearAutoCloseTimer();
      setOpen(false);
      return;
    }
    clearOpenTimer();
    clearHideTimer();
    const nextPosition = calculatePosition();
    if (nextPosition) setPosition(nextPosition);
    setOpen(true);
    scheduleAutoClose();
  };
  const scheduleShowTooltip = () => {
    clearHideTimer();
    clearOpenTimer();
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      closeOtherPopovers();
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
    trigger.addEventListener("click", openTooltipByClick);

    return () => {
      trigger.removeEventListener("pointerenter", scheduleShowTooltip);
      trigger.removeEventListener("pointerleave", scheduleHideTooltip);
      trigger.removeEventListener("focusin", openTooltipImmediately);
      trigger.removeEventListener("focusout", handleFocusOut);
      trigger.removeEventListener("click", openTooltipByClick);
      clearOpenTimer();
      clearHideTimer();
      clearAutoCloseTimer();
    };
  }); // Ohne Dependency-Array: bei jedem Render an den aktuell sichtbaren Parent-Chip neu binden.

  useEffect(() => {
    if (badge.key !== "site_address") return;

    const closeExecutionAddressPopoverV17_90L215 = () => {
      clearOpenTimer();
      clearHideTimer();
      clearAutoCloseTimer();
      setOpen(false);
    };
    const handleOutsidePointerDownV17_90L215 = (event: PointerEvent) => {
      if (!open) return;
      const target = event.target as Node | null;
      const trigger = anchorRef.current?.parentElement as HTMLElement | null;
      if (target && trigger?.contains(target)) return;
      if (target && tooltipRef.current?.contains(target)) return;
      closeExecutionAddressPopoverV17_90L215();
    };

    document.addEventListener(
      "pointerdown",
      handleOutsidePointerDownV17_90L215,
      true,
    );
    window.addEventListener(
      "smartflow:close-execution-address-popovers",
      closeExecutionAddressPopoverV17_90L215,
    );
    return () => {
      document.removeEventListener(
        "pointerdown",
        handleOutsidePointerDownV17_90L215,
        true,
      );
      window.removeEventListener(
        "smartflow:close-execution-address-popovers",
        closeExecutionAddressPopoverV17_90L215,
      );
    };
  }, [badge.key, open]);

  useEffect(() => {
    if (badge.key === "site_address") return;
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
    window.addEventListener(
      SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227,
      closePopover,
    );
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener(
        SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227,
        closePopover,
      );
    };
  }, [badge.key, open]);

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
  }, [open, align, badge.key, tooltip]);

  if (!tooltip) return null;

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
          onPointerLeave={scheduleHideTooltip}
          style={{
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
            top: position.top,
            bottom: position.bottom,
          }}
          className="pointer-events-auto fixed z-[2147483000] isolate opacity-100 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white px-3 py-3 text-left text-[11px] font-medium leading-snug text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          {badge.key === "site_address"
            ? renderExecutionAddressTooltipContentV17_95(tooltip)
            : badge.key === "special_notes_summary"
              ? renderOrderSpecialNotesTooltipContentV17_95(tooltip)
              : isAppointmentBadgeV17_90L169(badge)
                ? renderOrderAppointmentTooltipContentV17_90L169(badge, tooltip)
                : isOperationalDetailBadgeV17_90L169(badge)
                  ? renderOrderOperationalTooltipContentV17_90L169(badge, tooltip)
                  : tooltip.split("\n").map((line, index) => (
                      <span
                        key={`viewport_plain_${badge.key}_${index}`}
                        className="block whitespace-pre-wrap break-words"
                      >
                        {line}
                      </span>
                    ))}
        </span>,
          document.body,
        )}
    </>
  );
};

// V17.90L136: Einheitliche Leistungsdarstellung innen und außen.
const renderOrderServiceReviewTooltipLinesV17_135G = (
  tooltip: string,
  keyPrefix: string,
) => {
  const headingPattern =
    /^(?:Preis \/ Menge \/ Einheit prüfen|Einheit abweichend(?: · Einheit aus Text übernommen)?|Einheit ergänzt|Einheit prüfen|Preis abweichend(?: · Preis aus Text übernommen)?|Preis oder Einheit abweichend|Nicht im Katalog|Nicht im Leistungskatalog|Währung prüfen|Betrag prüfen|Leistungen prüfen|Auftrag prüfen)$/;
  let serviceIndexInSection = 0;

  return tooltip.split("\n").map((line, index) => {
    const trimmed = line.trim();
    if (/^[-─—–_]{6,}$/.test(trimmed)) {
      serviceIndexInSection = 0;
      return (
        <span
          key={`${keyPrefix}_sep_${index}`}
          className="my-2 block border-t border-slate-200 dark:border-slate-700"
        />
      );
    }

    const isHeading = headingPattern.test(trimmed);
    if (isHeading) serviceIndexInSection = 0;
    const isServiceTitle = /^(?:\*|•)\s+/.test(trimmed);
    const addServiceSpacing = isServiceTitle && serviceIndexInSection > 0;
    if (isServiceTitle) serviceIndexInSection += 1;
    const isCurrentPrice = /^(?:Aktuell|Berechnung):/i.test(trimmed);
    const isCatalogPrice = /^Katalogpreis:/i.test(trimmed);
    const emphasizeLine =
      isHeading ||
      isServiceTitle ||
      isCurrentPrice ||
      /—\s*Text\s+/i.test(trimmed);

    return (
      <span
        key={`${keyPrefix}_line_${index}`}
        className={`block min-w-0 ${addServiceSpacing ? "mt-2" : ""}`}
      >
        <span
          className={`block min-w-0 whitespace-pre-wrap break-words ${
            emphasizeLine
              ? "font-bold text-slate-950 dark:text-slate-50"
              : isCatalogPrice
                ? "font-normal text-slate-500 dark:text-slate-400"
                : "text-slate-600 dark:text-slate-300"
          }`}
        >
          {line}
        </span>
      </span>
    );
  });
};

const OrderServiceReviewTooltipContentV17_135G = ({
  badge,
}: {
  badge: ReviewBadge;
}) => {
  const groups = (badge.serviceReviewGroups || []).filter(
    (group) => group.count > 0 && compactText(group.tooltip),
  );
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);

  return (
    <>
      <span className="mb-2 block text-sm font-bold text-slate-950 dark:text-slate-50">
        {badge.label}
      </span>
      {groups.length > 1 ? (
        <span className="block space-y-2">
          {groups.map((group, index) => {
            const active = activeGroupKey === group.key;
            return (
              <span
                key={group.key}
                role="button"
                tabIndex={0}
                onPointerEnter={() => setActiveGroupKey(group.key)}
                onFocus={() => setActiveGroupKey(group.key)}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setActiveGroupKey((current) =>
                    current === group.key ? null : group.key,
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  setActiveGroupKey((current) =>
                    current === group.key ? null : group.key,
                  );
                }}
                className={`block cursor-pointer overflow-hidden rounded-lg border bg-white outline-none transition-colors dark:bg-slate-900 ${
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
                    <span className="block break-words font-bold text-slate-950 dark:text-slate-50">
                      {index + 1}. {group.title}
                    </span>
                    <span className="mt-0.5 block break-words text-[10px] text-slate-600 dark:text-slate-300">
                      {group.address}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                    Leistungen prüfen · {group.count}
                  </span>
                </span>
                {active && (
                  <span className="block border-t border-amber-200 bg-amber-50/50 p-2.5 dark:border-amber-900/60 dark:bg-amber-950/15">
                    {renderOrderServiceReviewTooltipLinesV17_135G(
                      group.tooltip,
                      `group_${group.key}`,
                    )}
                  </span>
                )}
              </span>
            );
          })}
        </span>
      ) : (
        renderOrderServiceReviewTooltipLinesV17_135G(
          cleanVisibleTooltipTextV17_35(badge.tooltip),
          `service_${badge.key}`,
        )
      )}
    </>
  );
};

const ViewportAwareOrderServiceTooltip = ({
  badge,
  align = "left",
}: {
  badge: ReviewBadge;
  align?: "left" | "right";
}) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const tooltip = cleanVisibleTooltipTextV17_35(badge.tooltip);

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
    window.dispatchEvent(
      new Event(SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227),
    );
    window.dispatchEvent(
      new Event("smartflow:close-execution-address-popovers"),
    );
  };

  const openTooltipImmediately = () => {
    closeOtherPopovers();
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
      closeOtherPopovers();
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
    const closePopover = () => {
      clearOpenTimer();
      clearHideTimer();
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
    window.addEventListener(
      SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227,
      closePopover,
    );
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener(
        SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227,
        closePopover,
      );
    };
  }, [open]);

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

  if (!tooltip) return null;

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
          onPointerEnter={clearHideTimer}
          onPointerLeave={scheduleHideTooltip}
          style={{
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
            top: position.top,
            bottom: position.bottom,
          }}
          className="pointer-events-auto fixed z-[2147483000] isolate opacity-100 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white px-3 py-3 text-left text-[11px] font-medium leading-snug text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <OrderServiceReviewTooltipContentV17_135G badge={badge} />
        </span>,
          document.body,
        )}
    </>
  );
};

const ViewportAwareOrderRedTooltipV17_90L78 = ({
  badge,
  align = "left",
}: {
  badge: ReviewBadge;
  align?: "left" | "right";
}) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const tooltip = cleanVisibleTooltipTextV17_35(badge.tooltip);

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
    const width = Math.max(280, Math.min(384, window.innerWidth - 24));
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
    const maxHeight = Math.max(1, Math.min(480, available));

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
    window.dispatchEvent(
      new Event(SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227),
    );
    window.dispatchEvent(
      new Event("smartflow:close-execution-address-popovers"),
    );
  };

  const openTooltipImmediately = () => {
    closeOtherPopovers();
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
      closeOtherPopovers();
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
  }, [align]);

  useEffect(() => {
    const closePopover = () => {
      clearOpenTimer();
      clearHideTimer();
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
    window.addEventListener(
      SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227,
      closePopover,
    );
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener(
        SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227,
        closePopover,
      );
    };
  }, [open]);

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

  if (!tooltip) return null;

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
          onPointerEnter={clearHideTimer}
          onPointerLeave={scheduleHideTooltip}
          style={{
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
            top: position.top,
            bottom: position.bottom,
          }}
          className="pointer-events-auto fixed z-[2147483000] isolate opacity-100 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white px-3 py-3 text-left text-[11px] font-medium leading-snug text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <span className="mb-2 block text-sm font-bold text-slate-950 dark:text-slate-50">
            {badge.label}
          </span>
          {renderStructuredRedReviewTooltipV17_90L73(
            tooltip,
            `viewport_red_${badge.key}`,
          )}
        </span>,
          document.body,
        )}
    </>
  );
};

const renderBadgeTooltip = (
  badge: ReviewBadge,
  align: "left" | "right" = "left",
  forceVisible = false,
) => {
  if (!forceVisible) {
    const tooltip = cleanVisibleTooltipTextV17_35(badge.tooltip);
    if (!tooltip) return null;
    const isStructuredRedReview =
      [
        "order_review_summary",
        "recognition_review",
        "currency_review",
        "price_quantity",
        "unit_conflict",
      ].includes(badge.key) &&
      /(?:^|\s)(?:bg|text|border)-red-/.test(badge.className || "");

    if (badge.key === "service_review_summary") {
      return <ViewportAwareOrderServiceTooltip badge={badge} align={align} />;
    }
    if (isStructuredRedReview) {
      return <ViewportAwareOrderRedTooltipV17_90L78 badge={badge} align={align} />;
    }
    return <ViewportAwareOrderBadgeTooltipV17_95 badge={badge} align={align} />;
  }
  if (badge.key === "site_address") {
    return renderExecutionAddressBadgeTooltipV17_90L56(
      badge,
      align,
      forceVisible,
      false,
    );
  }
  if (badge.key === "special_notes_summary") {
    return renderSpecialNotesSummaryTooltipV17_91(badge, align, forceVisible);
  }

  const tooltip = cleanVisibleTooltipTextV17_35(badge.tooltip);
  if (!tooltip) return null;

  const isStructuredRedReview =
    [
      "order_review_summary",
      "recognition_review",
      "currency_review",
      "price_quantity",
      "unit_conflict",
    ].includes(badge.key) &&
    /(?:^|\s)(?:bg|text|border)-red-/.test(badge.className || "");

  if (badge.key === "service_review_summary" && !forceVisible) {
    return <ViewportAwareOrderServiceTooltip badge={badge} align={align} />;
  }
  if (isStructuredRedReview && !forceVisible) {
    return <ViewportAwareOrderRedTooltipV17_90L78 badge={badge} align={align} />;
  }

  const alignClass = align === "right" ? "right-0" : "left-0";

  const tooltipLines = tooltip.split("\n");
  const isServiceReviewSummary = badge.key === "service_review_summary";
  const headingPattern =
    /^(?:Einheit abweichend(?: · Einheit aus Text übernommen)?|Einheit ergänzt|Einheit prüfen|Preis abweichend(?: · Preis aus Text übernommen)?|Preis oder Einheit abweichend|Nicht im Katalog|Nicht im Leistungskatalog|Währung prüfen|Betrag prüfen|Leistungen prüfen|Auftrag prüfen)$/;

  return (
    <span
      className={`pointer-events-none absolute ${alignClass} bottom-full z-[9999] mb-1 w-max max-w-[min(22rem,calc(100vw-2rem))] max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-[11px] font-medium leading-snug text-slate-800 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${forceVisible ? "block" : "hidden group-hover:block group-focus:block"}`}
    >
      {(isServiceReviewSummary || isStructuredRedReview) && (
        <span className="mb-2 block text-sm font-bold text-slate-950 dark:text-slate-50">
          {badge.label}
        </span>
      )}
      {isStructuredRedReview
        ? renderStructuredRedReviewTooltipV17_90L73(
            tooltip,
            `desktop_red_${badge.key}`,
          )
        : tooltipLines.map((line, index) => {
        const trimmed = line.trim();
        if (/^[-─—–_]{6,}$/.test(trimmed)) {
          return (
            <span
              key={`sep_${index}`}
              className="my-1 block border-t border-slate-200 dark:border-slate-700"
            />
          );
        }

        const emphasizeLine =
          headingPattern.test(trimmed) ||
          /^•\s+/.test(trimmed) ||
          /^Katalogpreis:/i.test(trimmed) ||
          /—\s*Text\s+/i.test(trimmed);

        return (
          <span
            key={`line_${index}`}
            className={`block min-w-0 whitespace-pre-wrap break-words ${emphasizeLine ? "font-bold text-slate-950 dark:text-slate-50" : ""}`}
          >
            {line}
          </span>
        );
      })}
    </span>
  );
};


const renderMobileSpecialNotesSummaryTooltipV17_91 = (
  badge: ReviewBadge,
  forceVisible = false,
) => {
  const tooltip = cleanVisibleTooltipTextV17_35(badge.tooltip);
  if (!tooltip) return null;
  const sections = splitSpecialNotesSummaryTooltipV17_91(tooltip);
  const hasSafety = sections.safety.length > 0;
  const hasPrimary = sections.primary.length > 0;
  const hasHints = sections.hints.length > 0;
  if (!hasSafety && !hasPrimary && !hasHints) return null;

  return (
    <span
      style={{
        left: "1rem",
        right: "1rem",
        width: "calc(100vw - 2rem)",
        maxWidth: "calc(100vw - 2rem)",
      }}
      className={`pointer-events-auto fixed top-1/2 z-[10000] block max-h-[62vh] -translate-y-1/2 overflow-y-auto overflow-x-hidden rounded-xl border border-slate-200 bg-white p-3 text-left text-[12px] font-medium leading-snug text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${forceVisible ? "block" : "hidden group-focus:block group-hover:block"}`}
    >
      {hasSafety && (
        <span className="mb-2 block rounded-lg border border-red-300 bg-red-50 p-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-100">
          <span className="mb-1 flex items-center gap-1 font-bold">
            <AlertTriangle className="h-4 w-4" /> Gefahr / Achtung
          </span>
          {sections.safety.map((line, index) => (
            <span key={`mobile_summary_safety_${index}`} className="block whitespace-pre-wrap break-words">
              • {line}
            </span>
          ))}
        </span>
      )}
      {hasPrimary && (
        <span className="mb-2 block rounded-lg border border-blue-300 bg-blue-50 p-2 text-blue-900 dark:border-blue-800/70 dark:bg-blue-950/30 dark:text-blue-100">
          <span className="mb-1 flex items-center gap-1 font-bold"><Info className="h-4 w-4" /> Wichtige Informationen</span>
          {sections.primary.map((line, index) => (
            <span key={`mobile_summary_primary_${index}`} className="block whitespace-pre-wrap break-words">{line}</span>
          ))}
        </span>
      )}
      {hasHints && (
        <span className="block rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-100">
          <span className="mb-1 block font-bold">Weitere Besonderheiten</span>
          {sections.hints.map((line, index) => (
            <span key={`mobile_summary_hint_${index}`} className="block whitespace-pre-wrap break-words">
              {line}
            </span>
          ))}
        </span>
      )}
    </span>
  );
};

const renderMobileSafeBadgeTooltip = (
  badge: ReviewBadge,
  forceVisible = false,
) => {
  if (badge.key === "site_address") {
    return renderExecutionAddressBadgeTooltipV17_90L56(
      badge,
      "left",
      forceVisible,
      true,
    );
  }
  if (badge.key === "special_notes_summary") {
    return renderMobileSpecialNotesSummaryTooltipV17_91(badge, forceVisible);
  }

  const tooltip = cleanVisibleTooltipTextV17_35(badge.tooltip);
  if (!tooltip) return null;

  if (isAppointmentBadgeV17_90L169(badge)) {
    return (
      <span
        style={{ left: "1rem", right: "1rem", width: "calc(100vw - 2rem)", maxWidth: "calc(100vw - 2rem)" }}
        className={`pointer-events-auto fixed top-1/2 z-[10000] block max-h-[62vh] -translate-y-1/2 overflow-y-auto overflow-x-hidden rounded-xl border border-slate-200 bg-white p-3 text-left shadow-2xl dark:border-slate-700 dark:bg-slate-900 ${forceVisible ? "block" : "hidden group-focus:block group-hover:block"}`}
      >
        {renderOrderAppointmentTooltipContentV17_90L169(badge, tooltip)}
      </span>
    );
  }

  if (isOperationalDetailBadgeV17_90L169(badge)) {
    return (
      <span
        style={{ left: "1rem", right: "1rem", width: "calc(100vw - 2rem)", maxWidth: "calc(100vw - 2rem)" }}
        className={`pointer-events-auto fixed top-1/2 z-[10000] block max-h-[62vh] -translate-y-1/2 overflow-y-auto overflow-x-hidden rounded-xl border border-slate-200 bg-white p-3 text-left shadow-2xl dark:border-slate-700 dark:bg-slate-900 ${forceVisible ? "block" : "hidden group-focus:block group-hover:block"}`}
      >
        {renderOrderOperationalTooltipContentV17_90L169(badge, tooltip)}
      </span>
    );
  }

  const tooltipLines = tooltip.split("\n");
  const isServiceReviewSummary = badge.key === "service_review_summary";
  const headingPattern =
    /^(?:Einheit abweichend(?: · Einheit aus Text übernommen)?|Einheit ergänzt|Einheit prüfen|Preis abweichend(?: · Preis aus Text übernommen)?|Preis oder Einheit abweichend|Nicht im Katalog|Nicht im Leistungskatalog|Währung prüfen|Betrag prüfen|Leistungen prüfen|Auftrag prüfen)$/;

  return (
    <span
      style={{
        left: "1rem",
        right: "1rem",
        width: "calc(100vw - 2rem)",
        maxWidth: "calc(100vw - 2rem)",
      }}
      className={`pointer-events-auto fixed top-1/2 z-[10000] block max-h-[62vh] -translate-y-1/2 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-[12px] font-medium leading-snug text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${forceVisible ? "block" : "hidden group-focus:block group-hover:block"}`}
    >
      {isServiceReviewSummary && (
        <span className="mb-2 block text-sm font-bold text-slate-950 dark:text-slate-50">
          {badge.label}
        </span>
      )}
      {tooltipLines.map((line, index) => {
        const trimmed = line.trim();
        if (/^[-─—–_]{6,}$/.test(trimmed)) {
          return (
            <span
              key={`mobile_sep_${index}`}
              className="my-1 block border-t border-slate-200 dark:border-slate-700"
            />
          );
        }

        const emphasizeLine =
          headingPattern.test(trimmed) ||
          /^•\s+/.test(trimmed) ||
          /^Katalogpreis:/i.test(trimmed) ||
          /—\s*Text\s+/i.test(trimmed);

        return (
          <span
            key={`mobile_line_${index}`}
            className={`block min-w-0 whitespace-pre-wrap break-words ${emphasizeLine ? "font-bold text-slate-950 dark:text-slate-50" : ""}`}
          >
            {line}
          </span>
        );
      })}
    </span>
  );
};

const renderReviewBadge = (
  badge: ReviewBadge,
  className: string,
  options: { strong?: boolean; tooltipAlign?: "left" | "right" } = {},
) => {
  const hasTooltip = Boolean(compactText(badge.tooltip));
  const CompactIcon = compactIconForBadge(badge);
  const compactSymbol = compactSymbolForBadge(badge);
  const isCompactIcon = Boolean(CompactIcon || compactSymbol);
  const visualClassName = isCompactIcon
    ? "h-7 w-7 justify-center rounded-lg px-0 py-0 text-[15px] font-semibold"
    : className;

  return (
    <span
      key={badge.key}
      tabIndex={hasTooltip ? 0 : undefined}
      onClick={(event) => {
        if (!hasTooltip) return;
        event.stopPropagation();
        const target = event.currentTarget as HTMLElement;
        if (document.activeElement === target) {
          target.blur();
        } else {
          target.focus();
        }
      }}
      className={`group relative inline-flex max-w-full items-center gap-1 ${isCompactIcon ? "rounded-lg" : "rounded-full"} shrink-0 outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ${visualClassName} ${
        options.strong
          ? getStrongerCardBadgeClassName(badge.className)
          : badge.className
      }`}
      aria-label={compactText(badge.tooltip) || badge.label}
    >
      {CompactIcon ? (
        <CompactIcon className="h-5 w-5" />
      ) : compactSymbol ? (
        <span aria-hidden="true" className="leading-none">
          {compactSymbol}
        </span>
      ) : (
        <>
          {badge.key === "callback_request" && (
            <span className="text-red-600 leading-none">☎</span>
          )}
          {badge.icon && badge.key !== "callback_request" && (
            <AlertTriangle className="w-3 h-3" />
          )}
          <span className="min-w-0 truncate">{badge.label}</span>
        </>
      )}
      {renderBadgeTooltip(badge, options.tooltipAlign || "left")}
    </span>
  );
};

const renderOrderCardBadge = (
  badge: ReviewBadge,
  tooltipAlign: "left" | "right" = "left",
) => {
  const isLargeYellowBadge = [
    "price_deviation",
    "catalog_missing",
    "catalog_review_combined",
    "service_review_summary",
    "order_review_summary",
  ].includes(badge.key);

  return renderReviewBadge(
    badge,
    isLargeYellowBadge
      ? "text-[11px] px-2 py-0.5 font-semibold"
      : "text-[10px] px-1.5 py-0.5 font-medium",
    { strong: true, tooltipAlign },
  );
};

const mobileIconForBadge = (badge: ReviewBadge) => {
  const compactIcon = compactIconForBadge(badge);
  if (compactIcon) return compactIcon;

  const label = normalizeForMatch(badge.label);
  if (badge.key === "site_address") return MapPin;
  if (badge.key === "special_notes_summary") return Info;
  if (badge.key === "callback_request") return Phone;
  if (badge.key === "appointment" || badge.key === "appointment_clarify")
    return CalendarDays;
  if (label.includes("park")) return ParkingCircle;
  if (label.includes("mail")) return Mail;
  if (label.includes("whatsapp")) return WhatsAppIcon;
  if (label.includes("sms")) return SmsIcon;
  if (badge.icon) return AlertTriangle;
  return null;
};

const mobileIconBadgeClass = (badge: ReviewBadge) => {
  const className = badge.className || "";
  if (/red/.test(className))
    return badge.key === "danger_warning"
      ? "bg-red-100 text-red-800 border-red-300"
      : "bg-red-50 text-red-700 border-red-300";
  if (/blue/.test(className)) return "bg-blue-50 text-blue-700 border-blue-300";
  if (/cyan/.test(className)) return "bg-cyan-50 text-cyan-700 border-cyan-300";
  if (/emerald|green/.test(className))
    return "bg-emerald-50 text-emerald-700 border-emerald-300";
  if (/violet|purple/.test(className))
    return "bg-violet-50 text-violet-700 border-violet-300";
  if (/yellow|amber|orange/.test(className))
    return "bg-amber-50 text-amber-700 border-amber-300";
  return "bg-slate-50 text-slate-700 border-slate-300";
};

const renderMobileIconBadge = (badge: ReviewBadge) => {
  const title = compactText(badge.tooltip) || badge.label;
  const Icon = mobileIconForBadge(badge);
  return (
    <button
      key={badge.key}
      type="button"
      tabIndex={0}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        const target = event.currentTarget as HTMLElement;
        if (document.activeElement === target) {
          target.blur();
        } else {
          target.focus();
        }
      }}
      className={`group relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[13px] font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ${mobileIconBadgeClass(badge)}`}
    >
      {Icon ? (
        <Icon
          className={badge.key === "danger_dog" ? "h-5 w-5" : "h-3.5 w-3.5"}
          strokeWidth={2.2}
        />
      ) : (
        badge.label.slice(0, 1)
      )}
      {renderMobileSafeBadgeTooltip(badge)}
    </button>
  );
};

const renderOrderContactTooltipV17_128 = (
  order: Order,
  phone: string,
  hint: string,
  align: "left" | "right" = "left",
) => {
  const alignClass = align === "right" ? "right-0" : "left-0";
  return (
    <span
      className={`pointer-events-none absolute ${alignClass} bottom-full z-[9999] mb-2 hidden w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-blue-200 bg-white p-3 text-left font-normal shadow-xl group-hover:block group-focus:block dark:border-slate-700 dark:bg-slate-950`}
    >
      <span className="block text-xs font-semibold text-blue-800 dark:text-blue-200">
        Telefonkontakt
      </span>
      <span className="mt-1 block break-words font-medium text-foreground">
        {order.customer?.name || "Kunde"}
      </span>
      <span className="mt-1 block break-words font-mono text-sm text-blue-700 dark:text-blue-300">
        {phone || "Keine Telefonnummer vorhanden"}
      </span>
      <span className="mt-2 block text-xs text-muted-foreground">
        {hint}
      </span>
    </span>
  );
};

// V17.90L119: The callback chip is rendered through the compact/mobile card path
// even on desktop. Use the same chip-anchored tooltip renderer as key/access
// instead of the viewport-centered mobile sheet.
const renderMobileActionBadge = (order: Order, badge: ReviewBadge) => {
  if (badge.key !== "callback_request") return renderMobileIconBadge(badge);

  const phone = getOrderPhoneForHref(order);
  const callbackInfo = compactText(badge.tooltip);
  return (
    <ContactActionChip
      key={badge.key}
      icon={Phone}
      label="Telefon"
      color="blue"
      href={phone ? `tel:${phone}` : undefined}
      title={
        phone
          ? [`Anrufen: ${phone}`, callbackInfo].filter(Boolean).join(" · ")
          : callbackInfo || "Rückruf gewünscht · Nummer fehlt"
      }
      compact
      contactHeading="Telefonkontakt"
      contactName={order.customer?.name || "Kunde"}
      contactValue={phone || "Keine Telefonnummer vorhanden"}
      contactHint={
        phone
          ? "Antippen oder anklicken, um anzurufen."
          : "Keine Telefonnummer hinterlegt."
      }
    />
  );
};

const renderMobileTextBadge = (
  badge: ReviewBadge,
  align: "left" | "right" = "right",
) =>
  renderReviewBadge(
    badge,
    "max-w-full truncate text-[10px] px-1.5 py-0.5 font-semibold",
    { strong: true, tooltipAlign: align },
  );

const renderMobileRightReviewBadge = (badge: ReviewBadge) => {
  const title = compactText(badge.tooltip) || badge.label;

  return (
    <button
      key={`mobile_review_${badge.key}`}
      type="button"
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        const target = event.currentTarget as HTMLElement;
        if (document.activeElement === target) {
          target.blur();
        } else {
          target.focus();
        }
      }}
      className={`group relative inline-flex max-w-full items-center justify-end rounded-full px-1.5 py-0.5 text-right text-[10px] font-semibold outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ${getStrongerCardBadgeClassName(badge.className)}`}
    >
      <span className="truncate">{badge.label}</span>
      {renderMobileSafeBadgeTooltip(badge)}
    </button>
  );
};

const mobileOverflowBadge = (count: number) =>
  count > 0 ? (
    <span
      key="mobile_more_badges"
      className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-1.5 text-[11px] font-semibold text-slate-600"
    >
      +{count}
    </span>
  ) : null;

const extractPhoneForHref = (...values: Array<string | null | undefined>) => {
  const source = values.filter(Boolean).join("\n");
  const explicitPhone =
    source.match(
      /(?:tel\.?|telefon|phone|mobile|handy|natel|whats\s*app(?:\s+nummer)?|sms|text\s+message|kurznachricht|kontakt(?:\s+vor\s+ort)?|anrufen|al[uü]te)\s*[:.]?\s*(\+?\d[\d\s()./-]{6,}\d)/i,
    )?.[1] ||
    source.match(
      /(?:bitte\s+)?(?:kurz\s+)?(?:anrufen|telefonieren|zur[uü]ckrufen|rueckrufen|ruckrufen).*?(\+?\d[\d\s()./-]{6,}\d)/i,
    )?.[1] ||
    source.match(/(\+\d[\d\s()./-]{7,}\d)/)?.[1] ||
    "";
  const normalized = explicitPhone.replace(/[^+0-9]/g, "");
  return normalized.length >= 7 ? normalized : "";
};

const extractOperationalPhoneForHrefV17_90L85 = (
  ...values: Array<string | null | undefined>
) => {
  const source = values
    .filter(Boolean)
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!source) return "";

  const phoneMatches = (value: string) =>
    Array.from(value.matchAll(/\+?\d[\d\s()./-]{6,}\d/g))
      .map((match) => ({
        value: String(match[0] || "").trim(),
        index: match.index || 0,
      }))
      .filter(({ value }) => {
        const digits = value.replace(/\D/g, "");
        return digits.length >= 7 && digits.length <= 15;
      });

  const markerRe =
    /\b(?:kontakt\s+vor\s+ort|kontaktperson\s+vor\s+ort|ansprechperson\s+vor\s+ort|ansprechpartner(?:in)?\s+vor\s+ort|vor\s+ort\s+ansprechpartner(?:in)?|person\s+vor\s+ort|vor\s+ort\s+(?:ist|öffnet|oeffnet)|on[-\s]?site(?:\s+contact)?|contact\s+sur\s+place|contatto\s+sul\s+posto|contacto\s+en\s+sitio)\b/i;
  const markerMatch = source.match(markerRe);
  if (markerMatch?.index != null) {
    const scoped = source.slice(markerMatch.index);
    const local = phoneMatches(scoped)[0]?.value || "";
    const normalized = local.replace(/[^+0-9]/g, "");
    if (normalized.length >= 7) return normalized;
  }

  const channelMatch = source.match(
    /\b(?:whats\s*app|whatsapp|sms|text\s+message|kurznachricht|anrufen|telefonieren|call)\b/i,
  );
  if (channelMatch?.index != null) {
    const closest = phoneMatches(source).sort(
      (left, right) =>
        Math.abs(left.index - (channelMatch.index || 0)) -
        Math.abs(right.index - (channelMatch.index || 0)),
    )[0]?.value;
    const normalized = String(closest || "").replace(/[^+0-9]/g, "");
    if (normalized.length >= 7) return normalized;
  }

  return "";
};

const normalizeStoredPhoneForTelHrefV17_90K6 = (value?: string | null) => {
  const normalized = String(value || "").replace(/[^+0-9]/g, "");
  return normalized.length >= 6 ? normalized : "";
};

const getOrderPhoneForHref = (order: Order) => {
  const canonicalSnapshotV2 = getCanonicalIntakeV2(order);
  if (canonicalSnapshotV2) {
    const communication = canonicalCommunicationDataV2(canonicalSnapshotV2);
    const explicitContact = extractDocumentContactFallback(
      order.notes,
      order.audioTranscript,
      order.specialNotes,
    );
    return normalizeStoredPhoneForTelHrefV17_90K6(
      communication.targetPhone ||
        explicitContact.phone ||
        canonicalSnapshotV2.customer.phone,
    );
  }
  if (isIntakeV2Order(order)) return "";
  // A contact explicitly named in the current order message is the action
  // target for SMS/WhatsApp/call chips. The stored customer phone remains a
  // fallback and is never overwritten by intake.
  const operationalPhone = extractOperationalPhoneForHrefV17_90L85(
    order.specialNotes,
    order.notes,
    order.audioTranscript,
  );
  if (operationalPhone) return operationalPhone;

  const storedCustomerPhone = normalizeStoredPhoneForTelHrefV17_90K6(
    order.customer?.phone ||
      (order as any).phone ||
      (order as any).customerPhone ||
      (order as any).contactPhone,
  );
  if (storedCustomerPhone) return storedCustomerPhone;

  return extractPhoneForHref(
    order.specialNotes,
    order.notes,
    order.audioTranscript,
  );
};

const renderCallbackCardBadge = (
  order: Order,
  badge: ReviewBadge,
  _tooltipAlign: "left" | "right" = "left",
) => {
  const phone = getOrderPhoneForHref(order);
  const callbackInfo = compactText(badge.tooltip);
  return (
    <ContactActionChip
      key={badge.key}
      icon={Phone}
      label="Telefon"
      color="blue"
      href={phone ? `tel:${phone}` : undefined}
      title={
        phone
          ? [`Anrufen: ${phone}`, callbackInfo].filter(Boolean).join(" · ")
          : callbackInfo || "Rückruf gewünscht · Nummer fehlt"
      }
      compact
      contactHeading="Telefonkontakt"
      contactName={order.customer?.name || "Kunde"}
      contactValue={phone || "Keine Telefonnummer vorhanden"}
      contactHint={
        phone
          ? "Antippen oder anklicken, um anzurufen."
          : "Keine Telefonnummer hinterlegt."
      }
    />
  );
};

const stripServiceLabelFieldArtifactsV17_47 = (value?: string | null) => {
  let text = compactText(value);
  while (
    /(?:^|[\s,;:–—-]+)(?:flaeche|fläche|anzahl|menge|preis|einheit|stueckzahl|stückzahl|quantity|area|amount|price|unit)\s*[:=]?\s*$/i.test(
      normalizeForMatch(text),
    )
  ) {
    text = compactText(
      text.replace(
        /(?:^|[\s,;:–—-]+)(?:flaeche|fläche|anzahl|menge|preis|einheit|stueckzahl|stückzahl|quantity|area|amount|price|unit)\s*[:=]?\s*$/i,
        " ",
      ),
    );
  }
  return text;
};

const cleanServiceLabel = (value?: string | null) => {
  let text = stripServiceLabelFieldArtifactsV17_47(
    canonicalServiceNameForOrderItem(value),
  );
  if (!text) return "";

  text = text
    .replace(/^[-–—•\d.)\s]+/, "")
    .replace(/\s+[–—]\s+.*$/, "")
    .replace(/\s+-\s+.*$/, "")
    // Einheit-/Preiswörter gehören nicht in den sichtbaren Kartentitel.
    .replace(
      /\b(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  text = stripServiceLabelFieldArtifactsV17_47(text);

  if (text.length > 55) {
    text = `${text.slice(0, 52).trim()}…`;
  }

  return text;
};

const uniqueServiceLabels = (labels: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  labels.forEach((label) => {
    const cleaned = cleanServiceLabel(label);
    const key = normalizeForMatch(cleaned);
    if (!cleaned || seen.has(key)) return;
    seen.add(key);
    result.push(cleaned);
  });

  return result;
};

const formatServiceSummary = (labels: string[]) => {
  const unique = uniqueServiceLabels(labels);
  if (unique.length === 0) return "";
  return unique.join(" + ");
};

const extractFallbackServiceLabels = (order: Order) => {
  const raw = [
    order.description,
    order.serviceName,
    order.notes,
    order.audioTranscript,
  ]
    .map((part) => compactText(part))
    .filter(Boolean)
    .join(". ");

  const text = normalizeForMatch(raw);
  const labels: string[] = [];

  const addIf = (regex: RegExp, label: string) => {
    if (regex.test(text)) labels.push(label);
  };

  addIf(/baum.*(faell|gefaellt|entfern|schneid|rod)/, "Baum fällen");
  addIf(/rasen.*(maeh|maehen|schnitt)/, "Rasen mähen");
  addIf(/treppenhaus.*rein/, "Treppenhaus reinigen");
  addIf(/kellerboden.*rein|keller.*boden.*rein/, "Kellerboden reinigen");
  addIf(/farbe.*entfern|alte farbe.*entfern/, "Farbe entfernen");
  addIf(/fenster.*rein/, "Fenster reinigen");
  addIf(/unterhaltsreinigung/, "Unterhaltsreinigung");
  addIf(/hauswartung/, "Hauswartung");
  addIf(/hecke.*(schneid|schnitt)/, "Hecke schneiden");
  addIf(/strasse.*rein|weg.*rein|platz.*rein/, "Aussenbereich reinigen");

  const known = uniqueServiceLabels(labels);
  if (known.length > 0) return known;

  const beforeDash = compactText(raw.split(/[–—]/)[0]);
  if (beforeDash.length >= 3 && beforeDash.length <= 80) {
    return [beforeDash];
  }

  const cleaned = compactText(raw)
    .replace(/das beigefuegte bild zeigt.*$/i, "")
    .replace(/das beigefügte bild zeigt.*$/i, "")
    .replace(/weitere details.*$/i, "")
    .replace(
      /der kunde moechte|der kunde möchte|kunde moechte|kunde möchte/gi,
      "",
    )
    .replace(/\b(ein|eine|einen|soll|sollen|muss|muessen|müssen|bitte)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return [];
  return [cleaned.length > 80 ? `${cleaned.slice(0, 77).trim()}…` : cleaned];
};

const cleanCardServiceLabelV17_34 = (value?: string | null) =>
  compactText(value)
    .replace(/^\s*(?:text|kundentext|quelle|source|evidence)\s*[:：]\s*/i, "")
    .replace(
      /^\s*\[(?:HINWEIS|INFO|NOTIZ|GEFAHR|WARNUNG|WARNHINWEIS)\]\s*/i,
      "",
    )
    .trim();

const getOrderCardServiceSummary = (order: Order) => {
  const itemLabels =
    order.items && order.items.length > 0
      ? order.items.map((item) => cleanCardServiceLabelV17_34(item.serviceName))
      : [];

  const structuredLabels =
    itemLabels.length > 0
      ? itemLabels
      : [cleanCardServiceLabelV17_34(order.serviceName) || ""];
  const usableStructuredLabels = structuredLabels.filter(
    (label) =>
      normalizeForMatch(label) !== "sonstiges" &&
      !isInternalReviewServiceName(label),
  );

  const structuredSummary = formatServiceSummary(usableStructuredLabels);
  if (structuredSummary) return structuredSummary;

  const fallbackSummary = formatServiceSummary(
    extractFallbackServiceLabels(order),
  );
  return fallbackSummary || "Unklare Leistung";
};

const formatMobileServiceSummary = (labels: string[]) => {
  const unique = uniqueServiceLabels(labels);
  if (unique.length === 0) return "Leistung prüfen";
  const visible = unique.slice(0, 3);
  const hidden = unique.length - visible.length;
  return `${visible.join(" · ")}${hidden > 0 ? ` · +${hidden}` : ""}`;
};

const getMobileOrderCardServiceSummary = (order: Order) => {
  const itemLabels =
    order.items && order.items.length > 0
      ? order.items.map((item) => cleanCardServiceLabelV17_34(item.serviceName))
      : [];
  const structuredLabels =
    itemLabels.length > 0
      ? itemLabels
      : [cleanCardServiceLabelV17_34(order.serviceName) || ""];
  const usableStructuredLabels = structuredLabels.filter(
    (label) => normalizeForMatch(label) !== "sonstiges",
  );
  const structuredSummary = formatMobileServiceSummary(usableStructuredLabels);
  if (structuredSummary && structuredSummary !== "Leistung prüfen")
    return structuredSummary;
  return formatMobileServiceSummary(extractFallbackServiceLabels(order));
};

const emptyForm = {
  customerId: "",
  description: "",
  status: "Offen",
  date: new Date().toISOString().split("T")[0],
  notes: "",
  specialNotes: "",
  siteAddressDifferent: false,
  siteName: "",
  siteAddress: "",
  sitePlz: "",
  siteCity: "",
  siteNote: "",
};

const HARD_CURRENCY_CONVERSION_REVIEW_PATTERNS = [
  /^currency_/,
  /^item_currency_mismatch/,
  /^currency_conflict_item:/,
  /^currency_unsupported$/,
];

const isPersistedManualCurrencyConfirmedItem = (item: any) =>
  compactText(item?.description).startsWith(MANUAL_CURRENCY_CONFIRMED_PREFIX) ||
  compactText(item?.description).startsWith(PRICE_REVIEW_CONFIRMED_PREFIX);

const isUnresolvedConversionServiceNameV17_90L36b = (
  value?: string | null,
) => {
  const key = normalizeForMatch(value || "");
  if (!key) return true;
  return (
    key === "leistung pruefen" ||
    key === "leistung prufen" ||
    key === "unbekannte leistung" ||
    key === "unklare leistung" ||
    key.includes("leistung suchen") ||
    key.includes("leistung eingeben")
  );
};

const isUnresolvedConversionUnitV17_90L36b = (value?: string | null) => {
  const key = normalizeForMatch(value || "");
  if (!key) return true;
  return (
    key === "pruefen" ||
    key === "prufen" ||
    key === "einheit pruefen" ||
    key === "einheit prufen" ||
    key.includes("einheit fehlt") ||
    key.includes("einheit unklar") ||
    key.includes("unit missing") ||
    key.includes("unit unclear")
  );
};

const getOrderConversionBlockers = (order: Order | any): string[] => {
  const blockers: string[] = [];
  // Status ist absichtlich kein Blocker. Entscheidend ist nur der aktuell
  // gespeicherte, konkrete Zustand von Kunde, Adresse, Währung und Leistungen.
  const items: any[] = Array.isArray(order?.items) ? order.items : [];
  const reviewReasons: string[] = Array.isArray(order?.reviewReasons)
    ? order.reviewReasons.filter(Boolean)
    : [];

  if (items.length === 0) {
    blockers.push("Keine Leistungen vorhanden");
  }

  const hasUnresolvedServiceOrUnit = items.some(
    (item) =>
      isUnresolvedConversionServiceNameV17_90L36b(item?.serviceName) ||
      isUnresolvedConversionUnitV17_90L36b(item?.unit),
  );
  if (hasUnresolvedServiceOrUnit) {
    blockers.push("Leistung/Einheit prüfen");
  }

  const hasInvalidAmount = items.some((item) => {
    const quantity = Number(item?.quantity ?? 0);
    const unitPrice = Number(item?.unitPrice ?? 0);
    const total = Number(item?.totalPrice ?? unitPrice * quantity);
    return quantity <= 0 || unitPrice <= 0 || total <= 0;
  });
  if (hasInvalidAmount) {
    blockers.push("Preis/Menge prüfen");
  }

  if (
    reviewReasons.some((reason) =>
      HARD_CURRENCY_CONVERSION_REVIEW_PATTERNS.some((pattern) =>
        pattern.test(reason),
      ),
    )
  ) {
    blockers.push("Währung prüfen");
  }

  if (
    !getCanonicalIntakeV2(order) &&
    reviewReasons.some(isRecognitionReviewReasonV17_90L69)
  ) {
    blockers.push("Erkennung prüfen");
  }

  if (reviewReasons.includes("total_unrealistic_check")) {
    blockers.push("Betrag prüfen");
  }

  if (
    reviewReasons.some((reason) =>
      String(reason || "").startsWith("canonical_mutation_blocked:"),
    )
  ) {
    blockers.push("Erfassung prüfen");
  }

  if (hasActiveAddressRoleReviewV17_90K(order)) {
    blockers.push("Ausführungsadresse prüfen");
  }

  if (isCustomerDataIncomplete(order?.customer)) {
    blockers.push("Kundendaten prüfen");
  }

  // needsReview und alte intake_risk:* Gründe blockieren nicht pauschal.
  // Sobald die aktuellen Felder vollständig sind, darf Angebot/Rechnung weiter.
  return Array.from(new Set(blockers));
};

const blockConversionIfUnsafe = (
  order: Order | any,
  targetLabel: "Angebot" | "Rechnung",
) => {
  const blockers = getOrderConversionBlockers(order);
  if (blockers.length === 0) return false;

  toast.error(
    `${targetLabel} nicht möglich: ${blockers.slice(0, 3).join(", ")}`,
  );
  return true;
};

const formatDocumentApiBlockersV17_90L36 = (payload: any): string => {
  const rawBlockers = Array.isArray(payload?.blockers) ? payload.blockers : [];
  const blockers = rawBlockers.flatMap((entry: any) =>
    Array.isArray(entry?.blockers)
      ? entry.blockers
      : typeof entry === "string"
        ? [entry]
        : [],
  );
  return Array.from(new Set(blockers.map(compactText).filter(Boolean)))
    .slice(0, 3)
    .join(", ");
};


type ResponsiveOrderServiceRowV17_90L231 = {
  name: string;
  amountLabel: string;
};

function ResponsiveOrderServicePreviewV17_95({
  orderId,
  services,
  expanded,
  onToggle,
  onOpenItems,
}: {
  orderId: string;
  services: ResponsiveOrderServiceRowV17_90L231[];
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
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
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
            key={`${orderId}:responsive-service:${serviceIndex}`}
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

export default function AuftraegePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<ServiceDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string[] | null>(null);
  const [statusFilter, setStatusFilter] = useState("Alle");
  const [search, setSearch] = useState("");
  const [searchInputActive, setSearchInputActive] = useState(false);
  const [sortBy, setSortBy] = useState<
    "newest" | "oldest" | "name" | "amount" | "review"
  >("newest");
  // ─── Merge Assistant (guided 3-step flow) ───
  // Step 0 = inactive, Step 1 = selecting orders, Step 2 = main order + customer + preview, Step 3 = final review
  const [mergeStep, setMergeStep] = useState<0 | 1 | 2 | 3>(0);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [selectedMainOrderId, setSelectedMainOrderId] = useState<string | null>(
    null,
  );
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  );
  const [textPreviewOpen, setTextPreviewOpen] = useState<
    Record<string, boolean>
  >({});

  const [merging, setMerging] = useState(false);
  // Resolved image preview URLs (up to 3 per selected order)
  const [mergePreviewUrls, setMergePreviewUrls] = useState<
    Record<string, string[]>
  >({});
  // Resolved audio URLs for inline playback in merge Step 2
  const [mergeAudioUrls, setMergeAudioUrls] = useState<Record<string, string>>(
    {},
  );
  const isMergeMode = mergeStep === 1;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [siteAddressEditing, setSiteAddressEditing] = useState(false);
  const [saveExecutionAddressInCustomerProfile, setSaveExecutionAddressInCustomerProfile] =
    useState(true);
  const [customerExecutionAddressSaveModeV17_90L296, setCustomerExecutionAddressSaveModeV17_90L296] =
    useState<"local" | "create">("local");
  const [executionAddressClearRequested, setExecutionAddressClearRequested] =
    useState(false);
  const [executionAddressEditSnapshot, setExecutionAddressEditSnapshot] =
    useState("");

  useEffect(() => {
    if (!siteAddressEditing) return;
    setExecutionAddressEditSnapshot(
      serializeOrderExecutionAddressForEdit(form),
    );
    // Snapshot only when the editor changes from closed to open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteAddressEditing]);

  // Phase 2d (Stage 3): read-only info line shown in the edit dialog after an
  // Undo of auto-reuse, to give back the previously visible address context
  // without writing anything into the new minimal customer master record.
  const [undoPreviousAddress, setUndoPreviousAddress] = useState<{
    address: string | null;
    plz: string | null;
    city: string | null;
  } | null>(null);
  const [formItems, setFormItems] = useState<FormItem[]>([createEmptyItem()]);
  const [formWorkSites, setFormWorkSites] = useState<OrderWorkSite[]>([]);
  const [editingWorkSiteId, setEditingWorkSiteId] = useState<string | null>(
    null,
  );
  const [activeWorkSiteId, setActiveWorkSiteId] = useState<string | null>(null);
  const [newItemWorkSiteId, setNewItemWorkSiteId] = useState<string>("");
  const [expandedWorkSiteIds, setExpandedWorkSiteIds] = useState<string[]>([]);
  const [expandedServiceItemKeys, setExpandedServiceItemKeys] = useState<string[]>([]);
  const [customerMessagesExpanded, setCustomerMessagesExpanded] =
    useState(false);
  const [serviceOverviewExpanded, setServiceOverviewExpanded] = useState(false);
  const [movingItemKey, setMovingItemKey] = useState<string | null>(null);
  // Persisted MwSt on Auftrag — saved on the Order itself (see app/api/orders)
  // and forwarded to the derived Offer/Invoice when converting.
  const [orderVatRate, setOrderVatRate] = useState(8.1);
  const [defaultVatRate, setDefaultVatRate] = useState(8.1);
  const [currency, setCurrency] = useState<"CHF" | "EUR">("CHF");
  const [saving, setSaving] = useState(false);
  const [manualResidualCurrencyAcknowledged, setManualResidualCurrencyAcknowledged] =
    useState(false);
  const [discardedRecognitionReviewKeys, setDiscardedRecognitionReviewKeys] =
    useState<string[]>([]);

  // New customer inline / edit customer
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
  const [
    pendingBillingAddressRoleAutoSaveV17_64,
    setPendingBillingAddressRoleAutoSaveV17_64,
  ] = useState(false);

  // Stage E (deterministic chip flow): pending customerId waiting for the dialog
  // to mount + form to be populated before the customer-edit section is opened.
  // Set by `openEdit(o, { openCustomerSection: true })` when the user taps the
  // "Kundendaten unvollständig" / "Prüfen" chip in a list card. The effect
  // below picks it up once `dialogOpen && form.customerId === pendingId`,
  // loads fresh customer data and reveals the editor — guaranteed to run
  // AFTER the dialog has opened and the form is in sync, so it can never
  // race against `openEdit`'s own resets.
  const [pendingOpenCustomerEditor, setPendingOpenCustomerEditor] = useState<
    string | null
  >(null);
  const customerEditorRef = useRef<HTMLDivElement | null>(null);
  const specialNotesRef = useRef<HTMLDivElement | null>(null);
  const serviceItemsRef = useRef<HTMLDivElement | null>(null);
  const executionAddressRef = useRef<HTMLDivElement | null>(null);
  const [pendingFocusSection, setPendingFocusSection] = useState<
    "specialNotes" | "items" | "executionAddress" | null
  >(null);

  // New duplicate check (Phase C — Sheet-based)
  const [dupCheckOpen, setDupCheckOpen] = useState(false);

  // ISSUE 2 — Inline PLZ/city suggestion from exact duplicate matches.
  // Shown directly in the customer section without requiring "Duplikate prüfen".
  const [inlineSuggestion, setInlineSuggestion] = useState<{
    type: "plz" | "city";
    value: string;
    sourceName: string;
  } | null>(null);
  const inlineSuggestionFetchRef = useRef(0);

  // Android/browser back: close the edit dialog FIRST instead of jumping to the
  // previously visited module. Safe version — see lib/use-dialog-back-guard.ts.
  useDialogBackGuard(dialogOpen, () => setDialogOpen(false));

  // Block D — single shared entry point for "Kunde bearbeiten". Used by
  // both the existing "✏️ Bearbeiten" link AND the newly-clickable customer
  // display card. Phase 2f: fetch fresh customer data from the server so
  // stale local state can never silently wipe values. Fall back to local
  // state on error.
  //
  // Optional `customerIdOverride` lets callers (e.g. the list-card chip
  // shortcut) pass a customer id directly without first relying on the
  // form state being flushed — useful when called immediately after
  // `openEdit()` because React state updates batch.
  // Optional `noteOverride` is the order/record notes used to merge any
  // freshly-extracted customer fields. When omitted we look it up from the
  // current edit order (existing behavior).
  const openCustomerEditor = async (
    customerIdOverride?: string,
    noteOverride?: string | null,
  ) => {
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
      const currentOrder = editId
        ? orders.find((o: Order) => o.id === editId)
        : null;
      const canUseOrderNotesForCustomer = !hasMissingOrFallbackCustomerName(
        freshCust.name,
      );
      const noteSource = isIntakeV2Order(currentOrder)
        ? null
        : canUseOrderNotesForCustomer
          ? noteOverride !== undefined
            ? noteOverride
            : currentOrder?.notes
          : null;
      // ─── CRITICAL: Use a blank form as the base for merging, NOT the
      // potentially stale `newCust` state. This prevents data from a
      // previously viewed order/customer from leaking into the editor.
      // The customer's actual DB values are the sole source of truth.
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

  // Media playback
  const [mediaDialogOpen, setMediaDialogOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string | null>(null);
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [customerMessageImagePreviewUrls, setCustomerMessageImagePreviewUrls] =
    useState<string[]>([]);

  // Native action menus do not touch React state. This keeps large lists from
  // re-rendering when the three-dot menu is opened.
  const [activeMobileTooltipKey, setActiveMobileTooltipKey] = useState<
    string | null
  >(null);
  const [activeMobileTooltip, setActiveMobileTooltip] = useState<{
    key: string;
    tooltip: string;
    title?: string;
    kind?:
      | "service_review"
      | "order_review"
      | "execution_address"
      | "appointment"
      | "operational_danger"
      | "operational_hint"
      | "default";
    anchorRect?: {
      top: number;
      bottom: number;
      left: number;
      right: number;
      width: number;
      height: number;
    };
    serviceReviewGroups?: OrderServiceReviewGroup[];
  } | null>(null);
  const mobileInfoAutoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearMobileInfoAutoCloseV17_90L175 = () => {
    if (mobileInfoAutoCloseTimerRef.current) {
      clearTimeout(mobileInfoAutoCloseTimerRef.current);
      mobileInfoAutoCloseTimerRef.current = null;
    }
  };
  const scheduleMobileInfoAutoCloseV17_90L175 = () => {
    clearMobileInfoAutoCloseV17_90L175();
    if (!activeMobileTooltip || activeMobileTooltip.kind === "service_review") return;
    mobileInfoAutoCloseTimerRef.current = setTimeout(() => {
      setActiveMobileTooltipKey(null);
      setActiveMobileTooltip(null);
      setActiveMobileReviewGroupKey(null);
    }, 3000);
  };
  useEffect(() => {
    if (!activeMobileTooltip || activeMobileTooltip.kind === "service_review") {
      clearMobileInfoAutoCloseV17_90L175();
      return;
    }
    scheduleMobileInfoAutoCloseV17_90L175();
    return clearMobileInfoAutoCloseV17_90L175;
  }, [activeMobileTooltip?.key]);

  const [activeMobileReviewGroupKey, setActiveMobileReviewGroupKey] = useState<string | null>(null);
  const [expandedMobileServiceCards, setExpandedMobileServiceCards] = useState<Set<string>>(new Set());
  const [expandedOrderCardIds, setExpandedOrderCardIds] = useState<Set<string>>(new Set());
  const [orderCardExpansionRestored, setOrderCardExpansionRestored] = useState(false);
  const [orderCardInitialStateApplied, setOrderCardInitialStateApplied] = useState(false);
  const [visibleCount, setVisibleCount] = useState(30);

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
        "smartflow:auftraege:expanded-card-ids:v1",
      );
      if (stored !== null) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setExpandedOrderCardIds(
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
        "smartflow:auftraege:expanded-card-ids:v1",
      );
    }
    setOrderCardInitialStateApplied(restored);
    setOrderCardExpansionRestored(true);
  }, []);

  const toggleMobileServiceCard = (id: string) => {
    setExpandedMobileServiceCards((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleOrderCard = (id: string) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
      new Event(SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227),
    );
      window.dispatchEvent(
        new Event("smartflow:close-execution-address-popovers"),
      );
    }
    setExpandedOrderCardIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [serviceActionMenuKey, setServiceActionMenuKey] = useState<
    string | null
  >(null);

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

  const [catalogDecision, setCatalogDecision] = useState<null | {
    index: number;
    itemKey: string;
    normalizedName: string;
    existing: ServiceDef;
    price: number;
    unit: string;
  }>(null);
  const [catalogDecisionSaving, setCatalogDecisionSaving] = useState(false);

  // Close native action menus on outside click without re-rendering the list.
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      document
        .querySelectorAll<HTMLDetailsElement>(
          "details[data-order-action-menu][open]",
        )
        .forEach((menu) => {
          if (!target || !menu.contains(target)) menu.open = false;
        });
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  // Close manual-service action menu when the user clicks anywhere outside it.
  useEffect(() => {
    if (!serviceActionMenuKey) return;
    const handler = () => setServiceActionMenuKey(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [serviceActionMenuKey]);

  const load = async () => {
    setLoading(true);
    setLoadError(null);

    // V17.86 PERFORMANCE: Die Auftragsliste darf nicht auf Kunden-/Service-
    // Katalogdaten warten. /api/orders enthält bereits die Kundendaten, die für
    // die Liste nötig sind. Kunden und Leistungen werden direkt danach im
    // Hintergrund nachgeladen, damit Merge/Editor/Katalog weiter funktionieren,
    // aber die Liste nicht 8-10 Sekunden leer bleibt.
    const {
      results: [o, settings],
      errors: firstErrors,
    } = await fetchAllJSON<[Order[], any]>([
      { url: "/api/orders", fallback: [] },
      { url: "/api/settings", fallback: null },
    ]);

    if (firstErrors.length >= 1 && !(o && o.length >= 0)) {
      setLoadError(firstErrors);
      setLoading(false);
      return;
    }

    const ordersFromApi = (o ?? []).map((order) =>
      repairOrderWorkSiteNamesForDisplayV17_90L176(order),
    );
    const initialCustMap = new Map<string, Customer>();
    ordersFromApi.forEach((order: any) => {
      if (order.customer && !initialCustMap.has(order.customer.id)) {
        initialCustMap.set(order.customer.id, order.customer);
      }
    });

    setOrders(ordersFromApi);
    setCustomers(Array.from(initialCustMap.values()));

    // Default VAT rate: from CompanySettings (mwstAktiv/mwstSatz) if available, else 8.1
    if (settings) {
      setCurrency(settings.currency === "EUR" ? "EUR" : "CHF");
      if (settings.mwstAktiv && settings.mwstSatz != null) {
        setDefaultVatRate(Number(settings.mwstSatz));
      } else if (settings.mwstAktiv === false) {
        setDefaultVatRate(0);
      }
    }

    if (firstErrors.length > 0) {
      toast.error("Aufträge konnten nur teilweise geladen werden");
    }
    setLoading(false);

    // Hintergrunddaten: nicht blockierend für die sichtbare Auftragsliste.
    fetchAllJSON<[Customer[], ServiceDef[]]>([
      { url: "/api/customers", fallback: [] },
      { url: "/api/services", fallback: [] },
    ]).then(({ results: [c, s], errors }) => {
      const custMap = new Map<string, Customer>();
      (c ?? []).forEach((cust: Customer) => custMap.set(cust.id, cust));
      ordersFromApi.forEach((order: any) => {
        if (order.customer && !custMap.has(order.customer.id)) {
          custMap.set(order.customer.id, order.customer);
        }
      });
      setCustomers(Array.from(custMap.values()));
      setServices(s ?? []);
      if (errors.length > 0) {
        toast.error("Kunden/Leistungen wurden nur teilweise geladen");
      }
    });
  };

  useEffect(() => {
    load();
  }, []);

  // V17.73: Leichtes Nachladen der gespeicherten Ausführungsorte.
  // - Beim Öffnen des Editors: Vorschläge aktuell halten.
  // - Beim Öffnen eines Auftrags mit erkannter Ausführungsadresse: prüfen, ob
  //   diese Adresse erstmals automatisch im Kundenprofil gespeichert wurde.
  // Keine komplette Kundenhistorie laden.
  useEffect(() => {
    const customerId = String(form.customerId || "").trim();
    const hasCurrentExecutionAddress = Boolean(
      form.siteAddressDifferent &&
      String(form.siteAddress || "").trim() &&
      String(form.sitePlz || "").trim() &&
      String(form.siteCity || "").trim(),
    );

    if (
      !dialogOpen ||
      !customerId ||
      (!siteAddressEditing &&
        !hasCurrentExecutionAddress &&
        !editingWorkSiteId)
    ) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `/api/customers/${customerId}/execution-addresses`,
        );
        if (!res.ok) return;

        const executionAddresses = await res.json();
        if (cancelled || !Array.isArray(executionAddresses)) return;

        setCustomers((prev) => {
          const exists = prev.some((entry) => entry.id === customerId);
          if (!exists) {
            return [
              ...prev,
              { id: customerId, executionAddresses } as Customer,
            ];
          }
          return prev.map((entry) =>
            entry.id === customerId ? { ...entry, executionAddresses } : entry,
          );
        });
      } catch {
        // Kein Toast: Der Nutzer kann die Adresse weiterhin manuell erfassen.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    dialogOpen,
    siteAddressEditing,
    editingWorkSiteId,
    form.customerId,
    form.siteAddressDifferent,
    form.siteAddress,
    form.sitePlz,
    form.siteCity,
  ]);

  // Auto-refresh on tab/window focus removed:
  // it caused visible reload flicker and scroll loss while editing orders.
  // Support ?kunde= filter from Kunden page, with optional autoEdit
  useEffect(() => {
    const kundeFilter = searchParams?.get("kunde");
    const autoEdit = searchParams?.get("autoEdit");
    if (kundeFilter) {
      setSearch(kundeFilter);
      if (autoEdit === "1" && orders.length > 0) {
        const match = orders.find(
          (o: Order) =>
            o.customer?.name?.toLowerCase() === kundeFilter.toLowerCase(),
        );
        if (match) openEdit(match);
      }
      router.replace("/auftraege", { scroll: false });
    }
  }, [orders]);

  useEffect(() => {
    const isNew = searchParams?.get("new") === "1";
    const custId = searchParams?.get("customerId");
    const editOrderId = searchParams?.get("edit");
    if (isNew) {
      setEditId(null);
      const newForm = { ...emptyForm };
      if (custId) newForm.customerId = custId;
      setForm(newForm);
      setFormItems([createEmptyItem()]);
      setManualResidualCurrencyAcknowledged(false);
      setDiscardedRecognitionReviewKeys([]);
      setFormWorkSites([]);
      setExpandedWorkSiteIds([]);
      setExpandedServiceItemKeys([]);
      setCustomerMessagesExpanded(false);
      setServiceOverviewExpanded(false);
      setShowNewCustomer(false);
      setDialogOpen(true);
      return;
    }
    // Package F: direct-fetch the exact target order by id so that open-from-detail
    // is reliable even if the order is filtered from the in-memory list (e.g.
    // already linked to an offer/invoice, or list still loading).
    if (editOrderId && !dialogOpen) {
      let cancelled = false;
      (async () => {
        try {
          const res = await fetch(`/api/orders/${editOrderId}`);
          if (cancelled) return;
          if (!res.ok) {
            toast.error(
              res.status === 404
                ? "Auftrag nicht gefunden"
                : "Fehler beim Öffnen",
            );
            router.replace("/auftraege", { scroll: false });
            return;
          }
          const order = await res.json();
          if (cancelled) return;
          openEdit(order);
          router.replace("/auftraege", { scroll: false });
        } catch {
          if (!cancelled) {
            toast.error("Fehler beim Öffnen");
            router.replace("/auftraege", { scroll: false });
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Only show orders NOT linked to an offer or invoice (they've been "moved")
  // V17.86 PERFORMANCE: Filter/Sort nicht bei jedem kleinen State-Update neu
  // über die komplette Liste rechnen. Tooltip- und Dialog-State darf die Liste
  // nicht erneut vollständig sortieren.
  const unlinked = useMemo(
    () => orders?.filter((o: Order) => !o.offerId && !o.invoiceId) ?? [],
    [orders],
  );

  const filtered = useMemo(() => {
    const searchKey = search?.toLowerCase() ?? "";
    return unlinked
      .filter((o: Order) => {
        if (statusFilter === "Offen" && o.status === "Erledigt") return false;
        if (statusFilter === "Erledigt" && o.status !== "Erledigt") return false;
        if (!searchKey) return true;
        const svcLine =
          o.items && o.items.length > 0
            ? o.items.map((it) => it.serviceName).join(" ")
            : (o.serviceName ?? "");
        return (
          o?.description?.toLowerCase()?.includes(searchKey) ||
          o?.customer?.name?.toLowerCase()?.includes(searchKey) ||
          svcLine.toLowerCase().includes(searchKey) ||
          o?.customer?.city?.toLowerCase()?.includes(searchKey) ||
          o?.customer?.customerNumber?.toLowerCase()?.includes(searchKey)
        );
      })
      .sort((a: Order, b: Order) => {
        switch (sortBy) {
          case "oldest":
            return (
              new Date(a.createdAt ?? a.date ?? 0).getTime() -
              new Date(b.createdAt ?? b.date ?? 0).getTime()
            );
          case "name":
            return (a.customer?.name ?? "").localeCompare(b.customer?.name ?? "");
          case "amount":
            return getSafeOrderTotal(b) - getSafeOrderTotal(a);
          case "review":
            return (
              (b.needsReview ? 1 : 0) - (a.needsReview ? 1 : 0) ||
              new Date(b.createdAt ?? 0).getTime() -
                new Date(a.createdAt ?? 0).getTime()
            );
          default:
            return (
              new Date(b.createdAt ?? b.date ?? 0).getTime() -
              new Date(a.createdAt ?? a.date ?? 0).getTime()
            );
        }
      });
  }, [unlinked, search, statusFilter, sortBy]);

  const visibleOrderIds = filtered
    .slice(0, visibleCount)
    .map((order) => order.id);
  const visibleOrderIdsKey = visibleOrderIds.join("\u241f");

  useEffect(() => {
    if (
      !orderCardExpansionRestored ||
      orderCardInitialStateApplied ||
      visibleOrderIds.length === 0
    )
      return;
    setExpandedOrderCardIds(new Set(visibleOrderIds));
    setOrderCardInitialStateApplied(true);
  }, [
    orderCardExpansionRestored,
    orderCardInitialStateApplied,
    visibleOrderIdsKey,
  ]);

  useEffect(() => {
    if (
      !orderCardExpansionRestored ||
      !orderCardInitialStateApplied ||
      typeof window === "undefined"
    )
      return;
    try {
      window.localStorage.setItem(
        "smartflow:auftraege:expanded-card-ids:v1",
        JSON.stringify(Array.from(expandedOrderCardIds)),
      );
    } catch {
      // Local storage can be unavailable in strict/private browser modes.
    }
  }, [
    orderCardExpansionRestored,
    orderCardInitialStateApplied,
    expandedOrderCardIds,
  ]);

  const allVisibleOrderCardsExpanded =
    visibleOrderIds.length > 0 &&
    visibleOrderIds.every((id) => expandedOrderCardIds.has(id));
  const toggleAllOrderCards = () => {
    setExpandedOrderCardIds((current) => {
      const next = new Set(current);
      visibleOrderIds.forEach((id) => {
        if (allVisibleOrderCardsExpanded) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  };

  const openNew = () => {
    setEditId(null);
    setForm(emptyForm);
    setFormItems([createEmptyItem()]);
    setManualResidualCurrencyAcknowledged(false);
    setDiscardedRecognitionReviewKeys([]);
    setFormWorkSites([]);
    setExecutionAddressClearRequested(false);
    setEditingWorkSiteId(null);
    setActiveWorkSiteId(null);
    setNewItemWorkSiteId("");
    setExpandedWorkSiteIds([]);
    setExpandedServiceItemKeys([]);
    setCustomerMessagesExpanded(false);
    setServiceOverviewExpanded(false);
    setSiteAddressEditing(false);
    setShowNewCustomer(false);
    setEditingCustomer(false);
    setOrderVatRate(defaultVatRate);
    setUndoPreviousAddress(null);
    setServiceActionMenuKey(null);
    setDialogOpen(true);
  };

  /**
   * Opens the order edit dialog for the given order.
   *
   * Optional `opts.openCustomerSection: true` immediately expands the
   * customer-edit panel and preloads fresh customer data — used by the
   * list-card "Kundendaten unvollständig" chip so the user lands directly
   * inside the customer editor with one tap (no extra "Bearbeiten" click).
   */
  const openEdit = (
    o: Order,
    opts?: {
      openCustomerSection?: boolean;
      focusSection?: "specialNotes" | "items" | "executionAddress";
    },
  ) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
      new Event(SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227),
    );
      window.dispatchEvent(
        new Event("smartflow:close-execution-address-popovers"),
      );
    }
    // V17.90L215: Ein offenes Ausführungsort-Popover darf niemals über dem
    // Bearbeitungsdialog stehen bleiben. Nur dieses Popover wird geschlossen;
    // Termin- und andere Chiplogik bleibt unverändert.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new Event("smartflow:close-execution-address-popovers"),
      );
    }
    setActiveMobileTooltipKey(null);
    setActiveMobileTooltip(null);
    if (
      typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
    ) {
      document.activeElement.blur();
    }

    const effectiveOrderReviewReasons =
      effectiveOrderReviewReasonsV17_90L37(o);
    setEditId(o.id);
    setExecutionAddressClearRequested(false);
    setManualResidualCurrencyAcknowledged(false);
    setDiscardedRecognitionReviewKeys([]);
    setServiceActionMenuKey(null);
    setDupCheckOpen(false);
    setUndoPreviousAddress(null);
    // ─── CRITICAL: Reset customer form to blank state BEFORE anything else.
    // Without this, stale customer data from a previously opened order leaks
    // into the merge logic of openCustomerEditor() and appears in the
    // customer editor for fallback / empty customers.
    setNewCust({
      name: "",
      phone: "",
      email: "",
      address: "",
      plz: "",
      city: "",
      country: "CH",
    });
    // V17.87: Kundenentwürfe ohne sichtbare K-Nummer werden bewusst nicht über
    // /api/customers in die normale Kundenliste geladen. Damit der Auftrag
    // trotzdem seine Rechnungsadresse/Kunde-prüfen-Karte bearbeiten kann, wird
    // der eingebettete order.customer lokal ergänzt.
    if (o.customerId && o.customer) {
      const embeddedCustomer = o.customer;
      const embeddedCustomerId = o.customerId;
      setCustomers((prev) => {
        if (prev.some((c) => c.id === embeddedCustomerId)) return prev;
        return [
          ...prev,
          {
            id: embeddedCustomerId,
            name: embeddedCustomer.name || "",
            customerNumber: embeddedCustomer.customerNumber ?? null,
            address: embeddedCustomer.address ?? null,
            plz: embeddedCustomer.plz ?? null,
            city: embeddedCustomer.city ?? null,
            phone: embeddedCustomer.phone ?? null,
            email: embeddedCustomer.email ?? null,
            country: "CH",
          } as Customer,
        ];
      });
    }
    const inferredSiteName = inferOrderExecutionSiteName(o);
    const safeInferredSiteName = isSameAddressPlaceholderV17_90L135H(
      inferredSiteName,
    )
      ? ""
      : inferredSiteName;
    const hasValidDifferentExecutionAddressV17_90L280 =
      hasDifferentExecutionAddressForBadge(o);
    const hasInvalidReverseHandoffExecutionStateV17_90L280 = Boolean(
      o.siteAddressDifferent && !hasValidDifferentExecutionAddressV17_90L280,
    );
    const effectiveSiteAddressDifferentV17_90L280 = Boolean(
      o.siteAddressDifferent && hasValidDifferentExecutionAddressV17_90L280,
    );

    setForm({
      customerId: o.customerId ?? "",
      description: o.description ?? "",
      status: o.status ?? "Offen",
      date: o.date ? new Date(o.date).toISOString().split("T")[0] : "",
      notes: o.notes ?? "",
      specialNotes: (() => {
        const parsedSpecialNotes = splitSpecialNotes(o.specialNotes);
        return buildSpecialNotes({
          safetyWarnings: parsedSpecialNotes.safetyWarnings,
          jobHints: parsedSpecialNotes.jobHints,
          preserveStructuredRoles: true,
        });
      })(),
      siteAddressDifferent: effectiveSiteAddressDifferentV17_90L280,
      siteName: hasInvalidReverseHandoffExecutionStateV17_90L280
        ? ""
        : isSameAddressPlaceholderV17_90L135H(o.siteName)
          ? ""
          : cleanWorkSiteDisplayName(o.siteName) || safeInferredSiteName || "",
      siteAddress: hasInvalidReverseHandoffExecutionStateV17_90L280
        ? ""
        : o.siteAddress ?? "",
      sitePlz: hasInvalidReverseHandoffExecutionStateV17_90L280
        ? ""
        : o.sitePlz ?? "",
      siteCity: hasInvalidReverseHandoffExecutionStateV17_90L280
        ? ""
        : o.siteCity ?? "",
      siteNote: hasInvalidReverseHandoffExecutionStateV17_90L280
        ? ""
        : o.siteNote ?? "",
    });
    const sourceWorkSitesForEditorV17_90L285 =
      hasInvalidReverseHandoffExecutionStateV17_90L280
        ? (o.workSites ?? []).filter((site) =>
            Boolean(
              compactText(site?.siteAddress) &&
                compactText(site?.sitePlz) &&
                compactText(site?.siteCity),
            ),
          )
        : o.workSites ?? [];
    const mayInferSingleSiteNameV17_90L285 =
      sourceWorkSitesForEditorV17_90L285.length === 1;
    const seenEditorWorkSiteIdsV17_90L302 = new Set<string>();
    const nextWorkSites = sourceWorkSitesForEditorV17_90L285
      .map((site, index) => {
        const safeSiteName = isSameAddressPlaceholderV17_90L135H(site.siteName)
          ? ""
          : cleanWorkSiteDisplayName(site.siteName);
        const rawSiteId = compactText(site.id);
        const stableSiteId =
          rawSiteId && !seenEditorWorkSiteIdsV17_90L302.has(rawSiteId)
            ? rawSiteId
            : `local-site-${o.id}-${index}`;
        seenEditorWorkSiteIdsV17_90L302.add(stableSiteId);
        return mayInferSingleSiteNameV17_90L285 &&
          index === 0 &&
          !safeSiteName &&
          safeInferredSiteName
          ? { ...site, id: stableSiteId, siteName: safeInferredSiteName }
          : { ...site, id: stableSiteId, siteName: safeSiteName || null };
      })
      .slice()
      .sort(
        (a, b) =>
          Number(b.isPrimary ? 1 : 0) - Number(a.isPrimary ? 1 : 0) ||
          Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0),
      );
    setFormWorkSites(nextWorkSites);
    setEditingWorkSiteId(null);
    setActiveWorkSiteId(nextWorkSites[0]?.id || null);
    setNewItemWorkSiteId(nextWorkSites.length === 1 ? nextWorkSites[0]?.id || "" : "");
    setExpandedWorkSiteIds([]);
    setExpandedServiceItemKeys([]);
    setCustomerMessagesExpanded(!shouldCollapseCustomerMessagesForOrder(o));
    setServiceOverviewExpanded(false);
    setMovingItemKey(null);
    setSiteAddressEditing(
      nextWorkSites.length <= 1 &&
        effectiveSiteAddressDifferentV17_90L280 &&
        ![o.siteName, o.siteAddress, o.sitePlz, o.siteCity, o.siteNote].some(
          (value) => String(value || "").trim(),
        ),
    );
    // Populate items from order
    if (o.items && o.items.length > 0) {
      const mappedItems: FormItem[] = o.items.map((item) => {
        const hasQuantityReview = hasQuantityReviewForService(
          effectiveOrderReviewReasons,
          item.serviceName,
        );
        const quantityNumber = Number(item.quantity || 0);
        const hasValidQuantity =
          Number.isFinite(quantityNumber) && quantityNumber > 0;
        const originalHadCurrencyMismatch = hasCurrencyMismatchReviewForService(
          o.reviewReasons,
          item.serviceName,
        );
        const effectiveHasCurrencyMismatch = hasCurrencyMismatchReviewForService(
          effectiveOrderReviewReasons,
          item.serviceName,
        );
        const extractedAiWarning = getAiWarningFromItemDescription(
          item.description,
        );
        const rawAiWarning =
          originalHadCurrencyMismatch && !effectiveHasCurrencyMismatch
            ? ""
            : extractedAiWarning;
        const isCatalogConfirmed =
          getCatalogReviewConfirmedFromItemDescription(item.description);
        const hasPersistedManualCurrencyConfirmation =
          getManualCurrencyConfirmedFromItemDescription(item.description);
        const isManualUnitConfirmed =
          getManualUnitConfirmedFromItemDescription(item.description);
        const isManualReviewConfirmed =
          getManualReviewConfirmedFromItemDescription(item.description);
        const hasItemCurrencyMismatch = hasCurrencyMismatchReviewForService(
          effectiveOrderReviewReasons,
          item.serviceName,
        );
        // V17.90L36c: Ein alter MANUAL_CURRENCY_CONFIRMED-Marker darf
        // einen weiterhin gespeicherten positionsbezogenen Währungsfehler
        // nicht überstimmen. Erst wenn der konkrete ReviewReason nach einer
        // echten manuellen Korrektur entfernt wurde, gilt die Position als
        // bestätigt.
        const isManualCurrencyConfirmed =
          hasPersistedManualCurrencyConfirmation &&
          !hasItemCurrencyMismatch;
        const shouldRequireFreshManualPrice =
          !isManualCurrencyConfirmed && hasItemCurrencyMismatch;
        const persistedHardReviewTextV17_90L247 = normalizeForMatch(
          [item.reviewReason, item.description].filter(Boolean).join(" "),
        );
        const hasPendingManualReviewDecisionV17_90L247 = Boolean(
          !isManualReviewConfirmed &&
            (isInternalReviewServiceName(item.serviceName) ||
              isUnitMissingReviewText(item.unit) ||
              !hasValidQuantity ||
              Number(item.unitPrice || 0) <= 0 ||
              hasItemCurrencyMismatch ||
              Boolean(
                findUnitMissingInTextReviewForService(
                  effectiveOrderReviewReasons,
                  item.serviceName,
                ),
              ) ||
              Boolean(
                findCanonicalMutationReviewForServiceV17_90L241(
                  effectiveOrderReviewReasons,
                  item.serviceName,
                ),
              ) ||
              Boolean(
                findPriceContradictionReviewForServiceV17_90L234(
                  effectiveOrderReviewReasons,
                  item.serviceName,
                ),
              ) ||
              /(?:service[_\s-]*action[_\s-]*unclear|price[_\s-]*(?:unclear|contradiction)|quantity[_\s-]*(?:review|unclear|missing)|unit[_\s-]*(?:review|unclear|missing)|currency[_\s-]*(?:review|conflict|mismatch)|canonical[_\s-]*mutation[_\s-]*blocked)/i.test(
                persistedHardReviewTextV17_90L247,
              )),
        );

        return {
          key: Math.random().toString(36).slice(2),
          serviceName: canonicalServiceNameForOrderItem(
            item.serviceName ?? "",
          ),
          unit: item.unit ?? "Stunde",
          unitPrice: shouldRequireFreshManualPrice
            ? ""
            : Number(item.unitPrice || 0) === 0
              ? ""
              : String(item.unitPrice),
          quantity: !hasValidQuantity ? "" : String(item.quantity),
          aiWarning: isManualCurrencyConfirmed ? "" : rawAiWarning,
          catalogReviewConfirmed: isCatalogConfirmed,
          manualCurrencyConfirmed: isManualCurrencyConfirmed,
          manualUnitConfirmed: isManualUnitConfirmed,
          manualReviewConfirmed: isManualReviewConfirmed,
          pendingManualReviewDecision:
            hasPendingManualReviewDecisionV17_90L247,
          pendingReviewSourceServiceName:
            hasPendingManualReviewDecisionV17_90L247
              ? canonicalServiceNameForOrderItem(item.serviceName)
              : "",
          sourceDescription: compactText(item.description),
          workSiteId: item.workSiteId || null,
        };
      });

      // V17.90L36d: Alte Mischwährungsaufträge besitzen teilweise nur einen
      // globalen Reviewgrund, obwohl im Kundentext eine zusätzliche
      // Fremdwährungsposition steht. Diese Position darf nicht unsichtbar
      // bleiben oder in eine andere Leistung hineinrutschen. Sie wird als
      // neutrale rote Prüfposition mit Total 0 angezeigt.
      const syntheticCurrencyReviewItems: FormItem[] = [];
      if (hasAnyCurrencyReviewReason(effectiveOrderReviewReasons)) {
        // V17.90L36e: Nicht nur das erste nicht-leere Textfeld verwenden.
        // Bei älteren Aufträgen steht die originale Kundennachricht häufig in
        // audioTranscript, während notes bereits nur Besonderheiten enthält.
        // Alle verfügbaren Quellen werden zusammengeführt, damit eine echte
        // Fremdwährungszeile wie "Travel cost EUR 35" sichtbar als rote
        // Prüfposition erzeugt werden kann.
        const sourceText = Array.from(
          new Set(
            [
              o.notes,
              o.audioTranscript,
              o.description,
              o.specialNotes,
              ...(o.items || []).flatMap((entry) => [
                entry.description || "",
                entry.serviceName || "",
              ]),
            ]
              .map((value) => String(value || "").trim())
              .filter(Boolean),
          ),
        ).join("\n");
        const foreignAmounts = extractForeignCurrencyAmountsV17_90L36D(
          sourceText,
          o.currency,
        );
        const confirmedResolvedCurrencyItems = mappedItems.filter(
          (item) =>
            Boolean(item.manualCurrencyConfirmed) &&
            String(item.serviceName || "").trim().length > 0 &&
            Number(item.unitPrice || 0) > 0 &&
            Number(item.quantity || 0) > 0,
        );

        foreignAmounts.forEach((foreign) => {
          const foreignCurrencyKey = normalizeForMatch(foreign.currency);
          const foreignAmountKey = normalizeForMatch(String(foreign.amount));
          const representedByConfirmedItem =
            confirmedResolvedCurrencyItems.some((item) => {
              const evidence = normalizeForMatch(
                [item.sourceDescription, item.aiWarning]
                  .filter(Boolean)
                  .join(" "),
              );
              return Boolean(
                evidence &&
                  evidence.includes(foreignCurrencyKey) &&
                  evidence.includes(foreignAmountKey),
              );
            }) ||
            (foreignAmounts.length === 1 &&
              confirmedResolvedCurrencyItems.length === 1);
          if (representedByConfirmedItem) return;

          const representedByEditableMismatchItem = mappedItems.some((item) => {
            if (
              !hasCurrencyMismatchReviewForService(
                effectiveOrderReviewReasons,
                item.serviceName,
              )
            )
              return false;
            const evidence = normalizeForMatch(item.aiWarning || "");
            return (
              evidence.includes(normalizeForMatch(foreign.currency)) &&
              evidence.includes(normalizeForMatch(String(foreign.amount)))
            );
          });
          if (representedByEditableMismatchItem) return;

          const duplicatePlaceholder = syntheticCurrencyReviewItems.some(
            (item) =>
              normalizeForMatch(item.aiWarning || "").includes(
                normalizeForMatch(`${foreign.currency} ${foreign.amount}`),
              ),
          );
          if (duplicatePlaceholder) return;

          syntheticCurrencyReviewItems.push({
            key: Math.random().toString(36).slice(2),
            serviceName: "Leistung prüfen",
            unit: "Pauschal",
            unitPrice: "",
            quantity: "1",
            aiWarning: `Währung prüfen: Fremdwährungsposition aus Kundentext (${foreign.currency} ${foreign.amount}). ${foreign.evidence}`,
            catalogReviewConfirmed: false,
            manualCurrencyConfirmed: false,
            manualUnitConfirmed: false,
            manualReviewConfirmed: false,
            pendingManualReviewDecision: true,
            pendingReviewSourceServiceName: "Leistung prüfen",
            sourceDescription: foreign.evidence,
            workSiteId: null,
          });
        });
      }

      const mergedEditorItems = mergeEquivalentFormItems([
        ...mappedItems,
        ...syntheticCurrencyReviewItems,
      ]);
      const sourceTextForEditorCleanup = [
        o.notes,
        o.audioTranscript,
        o.description,
        o.specialNotes,
      ]
        .filter(Boolean)
        .join("\n");
      const foreignEvidenceForEditorCleanup =
        extractForeignCurrencyAmountsV17_90L36D(
          sourceTextForEditorCleanup,
          o.currency,
        );
      const concreteForeignReviewCount = mergedEditorItems.filter((entry) => {
        if (isInternalReviewServiceName(entry.serviceName)) return false;
        if (Boolean(entry.manualCurrencyConfirmed)) return true;
        if (
          hasCurrencyMismatchReviewForService(
            effectiveOrderReviewReasons,
            entry.serviceName,
          )
        )
          return true;
        return isBlockingCurrencyReviewText(entry.aiWarning);
      }).length;
      const confirmedCurrencyReviewCount = mergedEditorItems.filter(
        (entry) =>
          Boolean(entry.manualCurrencyConfirmed) &&
          Number(entry.unitPrice || 0) > 0 &&
          Number(entry.quantity || 0) > 0,
      ).length;
      let staleGenericReviewBudget = Math.max(
        concreteForeignReviewCount,
        confirmedCurrencyReviewCount,
      );
      setFormItems(
        mergedEditorItems.filter((entry) => {
          if (!isInternalReviewServiceName(entry.serviceName)) return true;
          if (Number(entry.unitPrice || 0) > 0) return true;
          if (staleGenericReviewBudget <= 0) return true;

          const evidence = normalizeForMatch(
            [entry.aiWarning, entry.sourceDescription].filter(Boolean).join(" "),
          );
          const hasSpecificEvidence =
            evidence.length >= 18 &&
            !/^(?:leistung|einheit|preis|menge).*(?:unklar|pruefen|prufen)$/.test(
              evidence,
            );
          const duplicatesForeignEvidence =
            foreignEvidenceForEditorCleanup.some((foreign) => {
              const foreignKey = normalizeForMatch(foreign.evidence);
              return Boolean(
                foreignKey &&
                  evidence &&
                  (evidence.includes(foreignKey) ||
                    foreignKey.includes(evidence)),
              );
            });
          const isGenericBoilerplate =
            !evidence ||
            /^(?:leistung|einheit|preis|menge|vor angebot rechnung|diese position wird nicht).*(?:unklar|pruefen|prufen|netto|total)?$/.test(
              evidence,
            );

          if (isGenericBoilerplate || !hasSpecificEvidence || duplicatesForeignEvidence) {
            staleGenericReviewBudget -= 1;
            return false;
          }
          return true;
        }),
      );
    } else {
      setFormItems(
        mergeEquivalentFormItems([
          {
            key: Math.random().toString(36).slice(2),
            serviceName: o.serviceName ?? "",
            unit: o.priceType ?? "Stunde",
            unitPrice:
              Number(o.unitPrice || 0) === 0 ? "" : String(o.unitPrice),
            quantity: Number(o.quantity || 0) === 0 ? "" : String(o.quantity),
            aiWarning: "",
            catalogReviewConfirmed: false,
            manualCurrencyConfirmed: false,
            manualUnitConfirmed: false,
            workSiteId: null,
          },
        ]),
      );
    }
    if (opts?.openCustomerSection && o.customerId) {
      // Stage E (deterministic flow): DO NOT call openCustomerEditor() in this
      // synchronous click — React batches the setForm/setEditId/setDialogOpen
      // updates and the async fetch in openCustomerEditor would race against
      // them. Instead, mark a pending request; the effect below picks it up
      // once the dialog has mounted AND form.customerId matches, then loads
      // fresh customer data and reveals the editor section. This guarantees
      // the editor is opened *after* all opening-state has settled, so it can
      // never be stomped by openEdit's own resets.
      setPendingOpenCustomerEditor(o.customerId);
      // We intentionally DO NOT reset showNewCustomer / editingCustomer here.
      // The effect will set them to true once it runs.
    } else {
      setShowNewCustomer(false);
      setEditingCustomer(false);
      setPendingOpenCustomerEditor(null);
    }
    setOrderVatRate(o.vatRate != null ? Number(o.vatRate) : defaultVatRate);
    setCurrency(o.currency === "EUR" ? "EUR" : "CHF");
    setDialogOpen(true);
    setPendingFocusSection(opts?.focusSection || null);
    // V16.22: Do not auto-fill customer master data from order notes on dialog open.
    // Notes may contain execution addresses / onsite contact details and must not
    // silently write into the billing customer record. Manual customer editing stays available.
  };

  // Stage E (deterministic chip flow): the "open customer editor on dialog open"
  // effect. Watches for a pending request set by openEdit({openCustomerSection:true}).
  // Fires only AFTER the dialog has actually opened AND the form is populated
  // with the matching customerId — so it can never race against openEdit's own
  // state resets. Loads fresh customer data, reveals the editor, scrolls it
  // into view, then clears the pending flag.
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
          const currentOrder = editId
            ? orders.find((o: Order) => o.id === editId)
            : null;
          const noteSource = isIntakeV2Order(currentOrder)
            ? null
            : hasMissingOrFallbackCustomerName(freshCust.name)
              ? null
              : (currentOrder?.notes ?? null);
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
        // Reveal the editor — these run AFTER dialog open and AFTER any reset.
        setEditingCustomer(true);
        setShowNewCustomer(true);
        setPendingOpenCustomerEditor(null);
        // Scroll the editor into view on the next paint.
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

  // Clear the pending flag when the dialog closes — prevents a stale request
  // from triggering on a subsequent unrelated open.
  useEffect(() => {
    if (!dialogOpen) {
      setPendingOpenCustomerEditor(null);
      setPendingFocusSection(null);
    }
  }, [dialogOpen]);

  useEffect(() => {
    if (!dialogOpen || !pendingFocusSection) return;

    const frame = requestAnimationFrame(() => {
      if (pendingFocusSection === "specialNotes") {
        specialNotesRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        specialNotesRef.current?.focus?.();
      }

      if (pendingFocusSection === "items") {
        serviceItemsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        serviceItemsRef.current?.focus?.();
      }

      if (pendingFocusSection === "executionAddress") {
        executionAddressRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        executionAddressRef.current?.focus?.();
      }

      setPendingFocusSection(null);
    });

    return () => cancelAnimationFrame(frame);
  }, [dialogOpen, pendingFocusSection]);

  // ISSUE 2 — Fetch inline PLZ/city suggestion when customer card is shown.
  // Only fires for existing customers (editId) with missing PLZ or city.
  useEffect(() => {
    if (!dialogOpen || !editId || !form.customerId) {
      setInlineSuggestion(null);
      return;
    }
    // Don't fetch while customer editor is open (user is editing)
    if (showNewCustomer) return;
    const cust = customers.find((c: Customer) => c.id === form.customerId);
    if (!cust) return;
    const hasName = (cust.name || "").trim().length > 0;
    const hasAddress = (cust.address || "").trim().length > 0;
    const hasPlz = (cust.plz || "").trim().length > 0;
    const hasCity = (cust.city || "").trim().length > 0;
    // Need at least name + address + one of (plz, city) to check, and the other must be empty
    if (!hasName || !hasAddress) {
      setInlineSuggestion(null);
      return;
    }
    if (hasPlz && hasCity) {
      setInlineSuggestion(null);
      return;
    } // nothing missing
    if (!hasPlz && !hasCity) {
      setInlineSuggestion(null);
      return;
    } // can't suggest without either
    const fetchId = ++inlineSuggestionFetchRef.current;
    (async () => {
      try {
        const res = await fetch("/api/customers/find-duplicates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: cust.name,
            address: cust.address,
            plz: cust.plz,
            city: cust.city,
            phone: cust.phone,
            email: cust.email,
            excludeId: cust.id,
          }),
        });
        if (fetchId !== inlineSuggestionFetchRef.current) return;
        if (!res.ok) return;
        const matches = await res.json();
        const exakt = matches.filter((m: any) => m.classification === "EXAKT");
        if (exakt.length === 0) {
          setInlineSuggestion(null);
          return;
        }
        if (!hasPlz && hasCity) {
          // Suggest PLZ from exact matches
          const withPlz = exakt.filter(
            (m: any) => (m.plz || "").trim().length > 0,
          );
          if (withPlz.length === 0) {
            setInlineSuggestion(null);
            return;
          }
          const unique = Array.from(
            new Set(
              withPlz.map((m: any) => (m.plz || "").trim().toLowerCase()),
            ),
          );
          if (unique.length !== 1) {
            setInlineSuggestion(null);
            return;
          }
          setInlineSuggestion({
            type: "plz",
            value: (withPlz[0].plz || "").trim(),
            sourceName: withPlz[0].name,
          });
        } else if (hasPlz && !hasCity) {
          // Suggest city from exact matches
          const withCity = exakt.filter(
            (m: any) => (m.city || "").trim().length > 0,
          );
          if (withCity.length === 0) {
            setInlineSuggestion(null);
            return;
          }
          const unique = Array.from(
            new Set(
              withCity.map((m: any) => (m.city || "").trim().toLowerCase()),
            ),
          );
          if (unique.length !== 1) {
            setInlineSuggestion(null);
            return;
          }
          setInlineSuggestion({
            type: "city",
            value: (withCity[0].city || "").trim(),
            sourceName: withCity[0].name,
          });
        } else {
          setInlineSuggestion(null);
        }
      } catch {
        // Network error — no suggestion
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, editId, form.customerId, showNewCustomer, customers]);

  const applyInlineSuggestion = async () => {
    if (!inlineSuggestion || !form.customerId) return;
    const cust = customers.find((c: Customer) => c.id === form.customerId);
    if (!cust) return;
    const field = inlineSuggestion.type; // 'plz' or 'city'
    const value = inlineSuggestion.value;
    try {
      const res = await fetch(`/api/customers/${cust.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        const updated = await res.json();
        setCustomers((prev) =>
          prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
        );
        toast.success(
          `${field === "plz" ? "PLZ" : "Ort"} übernommen: ${value}`,
        );
        setInlineSuggestion(null);
      } else {
        toast.error("Fehler beim Übernehmen");
      }
    } catch {
      toast.error("Netzwerkfehler");
    }
  };

  const onItemServiceSelect = (
    index: number,
    name: string,
    svcOpt?: ServiceOption,
  ) => {
    setFormItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;

        // V17.90L40: Manche Combobox-Pfade liefern nur den Namen. Gibt es
        // gleichnamige Katalogeinträge, darf nicht der erste beliebige Treffer
        // genommen werden. Bevorzugt wird der tatsächlich übergebene Eintrag;
        // andernfalls der strukturell passendste Treffer zur bestehenden
        // Prüfposition (Einheit/Preis), damit z. B. Pauschal nicht zu Stunde wird.
        const targetNameKey = normalizeForMatch(
          canonicalServiceNameForOrderItem(name),
        );
        const exactCandidates = services.filter(
          (service) =>
            normalizeForMatch(
              canonicalServiceNameForOrderItem(service.name),
            ) === targetNameKey,
        );
        const isBlankItemBeforeCatalogSelection =
          !compactText(item.serviceName) &&
          Number(item.unitPrice || 0) <= 0 &&
          Number(item.quantity || 0) <= 0;
        const currentUnitKey = isBlankItemBeforeCatalogSelection
          ? ""
          : normalizePriceUnitForCompare(item.unit);
        const currentPrice = Number(item.unitPrice || 0);
        const svc =
          svcOpt ||
          exactCandidates
            .map((candidate) => {
              const candidateUnitKey = normalizePriceUnitForCompare(
                candidate.unit,
              );
              const candidatePrice = Number(candidate.defaultPrice || 0);
              let score = 0;
              if (currentUnitKey && candidateUnitKey === currentUnitKey)
                score += 100;
              if (
                currentPrice > 0 &&
                candidatePrice > 0 &&
                Math.abs(candidatePrice - currentPrice) < 0.01
              )
                score += 80;
              if (candidatePrice > 0) score += 20;
              if (candidateUnitKey) score += 10;
              return { candidate, score };
            })
            .sort((a, b) => b.score - a.score)[0]?.candidate;

        if (svc) {
          const selectedCatalogPrice = Number(svc.defaultPrice ?? 0);
          const selectingCurrencyReviewItem =
            isBlockingCurrencyReviewText(item.aiWarning) ||
            hasFormItemCurrencyMismatch(item);

          if (selectingCurrencyReviewItem) {
            const hasConfirmedCatalogPrice =
              Number.isFinite(selectedCatalogPrice) && selectedCatalogPrice > 0;
            const catalogUnit = compactText(svc.unit) || "Pauschal";
            const catalogIsFlat =
              normalizePriceUnitForCompare(catalogUnit) === "flat";

            return {
              ...item,
              serviceName: svc.name,
              unitPrice: hasConfirmedCatalogPrice
                ? String(selectedCatalogPrice)
                : "",
              // Die Katalogauswahl ersetzt die alte Prüf-Einheit vollständig.
              // Bei Anfahrt darf z. B. nicht "Stunde" aus der roten
              // Platzhalterposition stehen bleiben.
              unit: catalogUnit,
              quantity: catalogIsFlat
                ? "1"
                : Number(item.quantity || 0) > 0
                  ? item.quantity
                  : "1",
              aiWarning: hasConfirmedCatalogPrice ? "" : item.aiWarning,
              // Der bewusste Klick auf "Leistung · Preis · Einheit" ist eine
              // ausdrückliche Benutzerbestätigung und muss sofort sowie nach
              // Reload gelten.
              manualCurrencyConfirmed: hasConfirmedCatalogPrice,
              catalogReviewConfirmed: hasConfirmedCatalogPrice,
            };
          }

          const currentUnit = compactText(item.unit);
          const currentUnitKey = normalizeForMatch(currentUnit);
          const currentUnitIsOpen =
            !currentUnitKey ||
            currentUnitKey.includes("pruefen") ||
            currentUnitKey.includes("prufen");
          const catalogUnit = compactText(svc.unit);
          // Eine bewusste Katalogauswahl übernimmt immer exakt die im Katalog
          // gespeicherte Einheit. Ein alter Standardwert wie "Stunde" darf
          // nicht an der neuen Position hängen bleiben.
          const nextUnit = catalogUnit || "Einheit prüfen";
          const nextPrice =
            Number(item.unitPrice || 0) > 0
              ? item.unitPrice
              : String(svc.defaultPrice ?? 0);
          // Bei einer neuen/leeren Position wird keine Menge erfunden.
          // Erst die bewusste Eingabe des Nutzers bestätigt die Menge.
          const nextQuantity =
            Number(item.quantity || 0) > 0 ? item.quantity : "";
          const catalogSelectionResolvesOpenUnit = Boolean(
            currentUnitIsOpen &&
              catalogUnit &&
              Number(nextPrice || 0) > 0 &&
              Number(nextQuantity || 0) > 0,
          );

          return {
            ...item,
            serviceName: svc.name,
            unitPrice: nextPrice,
            unit: nextUnit,
            quantity: nextQuantity,
            // V17.90L43: Wählt der Benutzer in einer roten Einheit-prüfen-
            // Position bewusst eine Katalogleistung, gilt deren sichtbare
            // Katalogeinheit als ausdrückliche Bestätigung. Ein vorhandener
            // Textpreis (z. B. CHF 8 statt Katalog CHF 12) bleibt erhalten.
            aiWarning: catalogSelectionResolvesOpenUnit ? "" : item.aiWarning,
            manualUnitConfirmed:
              catalogSelectionResolvesOpenUnit || item.manualUnitConfirmed,
          };
        }

        if (!name) {
          return {
            ...item,
            serviceName: "",
            unitPrice: "",
            quantity: "",
            unit: "Einheit prüfen",
          };
        }

        return {
          ...item,
          serviceName: name,
        };
      }),
    );
  };

  const handleServiceCreated = (newSvc: ServiceOption) => {
    setServices((prev) => {
      const next = prev.filter(
        (service) =>
          service.id !== newSvc.id &&
          normalizeForMatch(service.name) !== normalizeForMatch(newSvc.name),
      );

      return [...next, newSvc as any].sort((a, b) =>
        (a?.name ?? "").localeCompare(b?.name ?? "", "de", {
          sensitivity: "base",
        }),
      );
    });
  };

  const isServiceInCatalog = (name?: string | null) => {
    const key = normalizeForMatch(name);
    if (!key) return false;
    return services.some((service) => normalizeForMatch(service.name) === key);
  };

  const getCatalogResolvedFormItems = (
    sourceItems: FormItem[],
    index: number,
    overrides: Partial<FormItem> = {},
  ) =>
    sourceItems.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...item,
            ...overrides,
            aiWarning: "",
          }
        : item,
    );

  const markItemCatalogReviewResolved = (
    index: number,
    overrides: Partial<FormItem> = {},
  ) => {
    setFormItems((prev) => getCatalogResolvedFormItems(prev, index, overrides));
  };

  const saveItemToServices = async (index: number) => {
    const item = formItems[index];
    if (!item?.serviceName?.trim()) return;

    const normalizedName = item.serviceName.trim().replace(/\s+/g, " ");
    const existing = services.find(
      (service) =>
        normalizeForMatch(service.name) === normalizeForMatch(normalizedName),
    );

    const price = Number(item.unitPrice || 0);
    if (!price || price <= 0) {
      toast.error("Preis zuerst prüfen, dann in Leistungen übernehmen");
      return;
    }

    const existingUnit = normalizePriceUnitForCompare(existing?.unit);
    const itemUnit = normalizePriceUnitForCompare(item.unit);
    const existingPrice = Number(existing?.defaultPrice || 0);
    const existingNeedsUpdate = Boolean(
      existing &&
      (existingUnit !== itemUnit || Math.abs(existingPrice - price) >= 0.01),
    );

    if (existing && existingNeedsUpdate) {
      setCatalogDecision({
        index,
        itemKey: item.key,
        normalizedName,
        existing,
        price,
        unit: item.unit,
      });
      setServiceActionMenuKey(null);
      return;
    }

    if (existing && !existingNeedsUpdate) {
      const nextItems = getCatalogResolvedFormItems(formItems, index, {
        serviceName: existing.name,
        catalogReviewConfirmed: false,
      });
      setFormItems(nextItems);

      if (editId) {
        const saved = await saveOrder(
          undefined,
          nextItems,
          new Set([normalizeForMatch(existing.name)]),
        );
        if (saved) {
          setOrders((prev) =>
            prev.map((order) =>
              order.id === saved.id ? { ...order, ...saved } : order,
            ),
          );
          await load();
        }
      }

      setServiceActionMenuKey(null);
      toast.success(
        "Leistung ist im Katalog und wurde im Auftrag gespeichert ✓",
      );
      return;
    }

    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: normalizedName,
          defaultPrice: price,
          unit: item.unit,
        }),
      });

      if (!res.ok) throw new Error("Fehler beim Speichern");

      const savedService: ServiceOption = await res.json();
      handleServiceCreated(savedService);
      onItemServiceSelect(index, savedService.name, savedService);
      const nextItems = getCatalogResolvedFormItems(formItems, index, {
        serviceName: savedService.name,
        catalogReviewConfirmed: false,
      });
      setFormItems(nextItems);

      if (editId) {
        const saved = await saveOrder(
          undefined,
          nextItems,
          new Set([normalizeForMatch(savedService.name)]),
        );
        if (saved) {
          setOrders((prev) =>
            prev.map((order) =>
              order.id === saved.id ? { ...order, ...saved } : order,
            ),
          );
          await load();
        }
      }

      setServiceActionMenuKey(null);
      toast.success(
        "Leistung wurde in Leistungen übernommen und Auftrag gespeichert ✓",
      );
    } catch {
      toast.error("Leistung konnte nicht übernommen werden");
    }
  };

  const resolveCatalogDecisionForCurrentOrder = async () => {
    if (!catalogDecision) return;

    const index = formItems.findIndex(
      (item) => item.key === catalogDecision.itemKey,
    );
    if (index < 0) {
      setCatalogDecision(null);
      return;
    }

    const nextItems = getCatalogResolvedFormItems(formItems, index, {
      serviceName:
        catalogDecision.existing.name || catalogDecision.normalizedName,
      catalogReviewConfirmed: true,
    });

    setCatalogDecisionSaving(true);
    try {
      setFormItems(nextItems);

      if (editId) {
        const saved = await saveOrder(undefined, nextItems);
        if (!saved) return;

        setOrders((prev) =>
          prev.map((order) =>
            order.id === saved.id ? { ...order, ...saved } : order,
          ),
        );
        await load();
      }

      setCatalogDecision(null);
      setServiceActionMenuKey(null);
      toast.success(
        "Nur dieser Auftrag wurde dauerhaft als geprüft gespeichert ✓",
      );
    } catch {
      toast.error("Prüfung konnte nicht gespeichert werden");
    } finally {
      setCatalogDecisionSaving(false);
    }
  };

  const updateCatalogPriceFromDecision = async () => {
    if (!catalogDecision) return;

    const index = formItems.findIndex(
      (item) => item.key === catalogDecision.itemKey,
    );
    if (index < 0) {
      setCatalogDecision(null);
      return;
    }

    setCatalogDecisionSaving(true);
    try {
      const res = await fetch("/api/services", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: catalogDecision.existing.id,
          name: catalogDecision.existing.name || catalogDecision.normalizedName,
          defaultPrice: catalogDecision.price,
          unit: catalogDecision.unit,
        }),
      });

      if (!res.ok) throw new Error("Fehler beim Speichern");

      const savedService: ServiceOption = await res.json();
      handleServiceCreated(savedService);
      onItemServiceSelect(index, savedService.name, savedService);
      const nextItems = getCatalogResolvedFormItems(formItems, index, {
        serviceName: savedService.name,
        unit: catalogDecision.unit,
        unitPrice: String(catalogDecision.price),
        catalogReviewConfirmed: false,
      });

      setFormItems(nextItems);

      if (editId) {
        const saved = await saveOrder(
          undefined,
          nextItems,
          new Set([normalizeForMatch(savedService.name)]),
        );
        if (!saved) return;

        setOrders((prev) =>
          prev.map((order) =>
            order.id === saved.id ? { ...order, ...saved } : order,
          ),
        );
        await load();
      }

      setCatalogDecision(null);
      setServiceActionMenuKey(null);
      toast.success(
        "Katalogpreis wurde global aktualisiert und Auftrag gespeichert ✓",
      );
    } catch {
      toast.error("Katalogpreis konnte nicht aktualisiert werden");
    } finally {
      setCatalogDecisionSaving(false);
    }
  };

  const updateItem = (index: number, field: keyof FormItem, value: string) => {
    if (field === "workSiteId") {
      setActiveWorkSiteId(value || null);
    }

    setFormItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;

        const nextItem: FormItem = { ...item, [field]: value };

        // V17.16: Sobald der Benutzer eine blockierte KI-/Währungsposition
        // manuell korrigiert, muss diese Position eindeutig als vom Benutzer
        // bestätigt gespeichert werden. Besonders Anfahrt kam sonst beim
        // erneuten Öffnen wieder aus der Originalzeile "Anfahrt CHF 50" zurück.
        if (
          field === "unitPrice" ||
          field === "quantity" ||
          field === "unit" ||
          field === "serviceName"
        ) {
          const currentEditOrder = editId
            ? orders.find((order) => order.id === editId)
            : null;
          const itemHadPriceContradictionV17_90L234 = Boolean(
            findPriceContradictionReviewForServiceV17_90L234(
              currentEditOrder?.reviewReasons,
              item.serviceName,
            ),
          );
          const itemHadPriceUnclearReviewV17_90L245 = Boolean(
            currentEditOrder?.reviewReasons?.some((reason) => {
              if (!String(reason || "").startsWith("price_unclear:")) {
                return false;
              }
              const reasonService = String(reason || "")
                .split(":")
                .slice(1)
                .join(":");
              return reviewServiceNamesMatchV17_90L241(
                reasonService,
                item.serviceName,
              );
            }),
          );
          const itemHadCurrencyOrPriceReview =
            hasFormItemCurrencyMismatch(item) ||
            itemHadPriceContradictionV17_90L234 ||
            itemHadPriceUnclearReviewV17_90L245 ||
            isBlockingCurrencyReviewText(item.aiWarning) ||
            Boolean(
              hasCurrentEditCurrencyReview &&
                (isInternalReviewServiceName(item.serviceName) ||
                  Number(item.unitPrice || 0) <= 0),
            );
          const unitText = normalizeForMatch(nextItem.unit);
          const isResolvedInput =
            nextItem.serviceName.trim().length > 0 &&
            unitText.length > 0 &&
            !unitText.includes("pruefen") &&
            !unitText.includes("prufen") &&
            Number(nextItem.unitPrice || 0) > 0 &&
            Number(nextItem.quantity || 0) > 0;

          const previousUnitText = normalizeForMatch(item.unit);
          const nextUnitText = normalizeForMatch(nextItem.unit);
          const hadUnitMissingReview = Boolean(
            findUnitMissingInTextReviewForService(
              currentEditOrder?.reviewReasons,
              item.serviceName,
            ),
          );
          const changedFromUnitReviewToConcreteUnit =
            field === "unit" &&
            isResolvedInput &&
            nextUnitText.length > 0 &&
            !nextUnitText.includes("pruefen") &&
            !nextUnitText.includes("prufen") &&
            (hadUnitMissingReview ||
              previousUnitText.includes("pruefen") ||
              previousUnitText.includes("prufen"));

          if (changedFromUnitReviewToConcreteUnit) {
            // V17.90L247: Keep the review evidence and pending state until the
            // user explicitly presses Übernehmen. Filling the last field alone
            // must not turn the red row yellow or remove the decision buttons.
            if (!item.pendingManualReviewDecision) {
              nextItem.aiWarning = "";
            }
            nextItem.manualUnitConfirmed = true;
          }

          // V17.90L244: Eine rote Preis-/Währungsprüfung wird nicht mehr allein
          // durch das Ausfüllen eines Feldes aufgelöst. Die bearbeitete Position
          // bleibt sichtbar rot und zeigt weiterhin Übernehmen/Verwerfen, bis
          // der Nutzer genau diese Position ausdrücklich bestätigt oder verwirft.
          // Eine bewusste Katalogauswahl behält ihren separaten Bestätigungsweg.
          if (itemHadCurrencyOrPriceReview) {
            nextItem.manualCurrencyConfirmed = false;
            nextItem.manualReviewConfirmed = false;
          }
        }

        return nextItem;
      }),
    );
  };

  const addItem = () => {
    const selectableSites = formWorkSites.filter((site) =>
      Boolean(
        compactText(site.siteName) ||
          compactText(site.siteAddress) ||
          compactText(site.sitePlz) ||
          compactText(site.siteCity) ||
          site.id === activeWorkSiteId ||
          site.id === editingWorkSiteId,
      ),
    );
    // V17.90L135J: Bei mehreren Arbeitsorten wird die Auswahl erst
    // innerhalb der neu geöffneten Leistungsposition getroffen. Dadurch bleibt
    // die Kopfzeile kompakt und es gibt dort kein dauerhaftes Dropdown mehr.
    const preferredEditedWorkSiteIdV17_90L285 =
      [editingWorkSiteId, newItemWorkSiteId]
        .map((value) => String(value || "").trim())
        .find((value) =>
          selectableSites.some((site) => site.id === value),
        ) || null;
    const targetWorkSiteId =
      preferredEditedWorkSiteIdV17_90L285 ||
      (selectableSites.length === 1 ? selectableSites[0]?.id || null : null);

    const nextItem = {
      ...createEmptyItem(),
      workSiteId: targetWorkSiteId,
    };

    setFormItems((prev) => [nextItem, ...prev]);
    setExpandedServiceItemKeys([nextItem.key]);
    if (targetWorkSiteId) {
      setActiveWorkSiteId(targetWorkSiteId);
      setExpandedWorkSiteIds((prev) =>
        prev.includes(targetWorkSiteId)
          ? prev
          : [targetWorkSiteId, ...prev],
      );
      setMovingItemKey(null);
    } else {
      setExpandedWorkSiteIds((prev) =>
        prev.includes("__unassigned__") ? prev : ["__unassigned__", ...prev],
      );
      setMovingItemKey(selectableSites.length > 1 ? nextItem.key : null);
    }
    setServiceActionMenuKey(null);
  };

  const addItemToWorkSite = (siteId?: string | null) => {
    const nextItem = {
      ...createEmptyItem(),
      workSiteId: siteId || null,
    };

    setFormItems((prev) => [nextItem, ...prev]);
    setExpandedServiceItemKeys([nextItem.key]);

    if (siteId) {
      setActiveWorkSiteId(siteId);
      setExpandedWorkSiteIds((prev) =>
        prev.includes(siteId) ? prev : [siteId, ...prev],
      );
      setMovingItemKey(null);
    } else {
      setExpandedWorkSiteIds((prev) =>
        prev.includes("__unassigned__") ? prev : ["__unassigned__", ...prev],
      );
      setMovingItemKey(hasMultipleEditWorkSites ? nextItem.key : null);
    }

    setServiceActionMenuKey(null);
  };

  const removeItem = (index: number) => {
    const removedItem = formItems[index];
    if (removedItem && isBlockingCurrencyReviewText(removedItem.aiWarning)) {
      // Das bewusste Verwerfen einer roten Fremdwährungs-Prüfposition gilt als
      // ausdrückliche Prüfung. Ein unsichtbarer Resthinweis darf danach nicht
      // erneut blockieren.
      setManualResidualCurrencyAcknowledged(true);
    }

    setFormItems((prev) => {
      if (prev.length <= 1) return [createEmptyItem()];
      return prev.filter((_, i) => i !== index);
    });
    if (removedItem) {
      setExpandedServiceItemKeys((current) =>
        current.filter((key) => key !== removedItem.key),
      );
    }
  };

  const currentEditOrder = editId
    ? orders.find((o: Order) => o.id === editId) || null
    : null;

  const currentEditReviewReasons =
    effectiveOrderReviewReasonsV17_90L37(currentEditOrder);
  const allCurrentRecognitionReviewDetailsV17_90L69 =
    getRecognitionReviewDetailsV17_90L69(currentEditOrder);
  const currentRecognitionReviewDetailsV17_90L69 =
    allCurrentRecognitionReviewDetailsV17_90L69.filter((detail) => {
      const key = recognitionReviewDetailKeyV17_90L70(detail);
      if (discardedRecognitionReviewKeys.includes(key)) return false;
      if (detail.kind && detail.kind !== "missing_work") return true;
      return !formItems.some(
        (item) =>
          item.recognitionReviewKey === key ||
          recognitionReviewDetailMatchesItemV17_90L69(detail, item),
      );
    });
  const hasGenericRecognitionReviewV17_90L70 =
    currentEditReviewReasons.includes(
      RECOGNITION_REVIEW_GENERIC_REASON_V17_90L69,
    ) &&
    !discardedRecognitionReviewKeys.includes(
      RECOGNITION_REVIEW_GENERIC_REASON_V17_90L69,
    );
  const hasCurrentRecognitionReviewV17_90L69 = Boolean(
    currentRecognitionReviewDetailsV17_90L69.length > 0 ||
      (hasGenericRecognitionReviewV17_90L70 &&
        allCurrentRecognitionReviewDetailsV17_90L69.length === 0),
  );

  const takeOverRecognitionReviewDetailV17_90L70 = (
    detail: RecognitionReviewPayloadV17_90L69,
  ) => {
    if (detail.kind && detail.kind !== "missing_work") {
      const key = recognitionReviewDetailKeyV17_90L70(detail);
      setDiscardedRecognitionReviewKeys((previous) =>
        previous.includes(key) ? previous : [...previous, key],
      );
      toast.success("Prüfung bestätigt. Bitte Auftrag speichern.");
      return;
    }

    if (
      formItems.some((item) =>
        recognitionReviewDetailMatchesItemV17_90L69(detail, item),
      )
    ) {
      toast.info("Leistung ist bereits vorhanden.");
      return;
    }

    const serviceName = recognitionReviewTakeoverTextV17_90L253(detail);
    const unit = compactText(detail.unit) || "Einheit prüfen";
    const quantity = Number(detail.quantity || 0);
    const unitPrice = Number(detail.unitPrice || 0);
    const originalSourceText = compactText(detail.sourceText);
    const displayEvidenceText = compactText(detail.relatedRoleText);
    const sourceDescription = originalSourceText || displayEvidenceText;
    const selectableSites = formWorkSites.filter((site) =>
      Boolean(
        compactText(site.siteName) ||
          compactText(site.siteAddress) ||
          compactText(site.sitePlz) ||
          compactText(site.siteCity) ||
          site.id === activeWorkSiteId ||
          site.id === editingWorkSiteId,
      ),
    );
    const defaultWorkSiteId =
      activeWorkSiteId ||
      (selectableSites.length === 1 ? selectableSites[0]?.id || null : null);
    const newItemKey = Math.random().toString(36).slice(2);
    const nextItem = {
      key: newItemKey,
      serviceName,
      unit,
      unitPrice: unitPrice > 0 ? String(unitPrice) : "",
      quantity: quantity > 0 ? String(quantity) : "",
      aiWarning: sourceDescription ? `Text: ${sourceDescription}` : "",
      catalogReviewConfirmed: false,
      manualCurrencyConfirmed: false,
      manualUnitConfirmed: Boolean(
        unit && !/(?:prüfen|pruefen|prufen)/i.test(unit),
      ),
      manualReviewConfirmed: false,
      pendingManualReviewDecision: true,
      pendingReviewSourceServiceName: serviceName,
      recognitionReviewKey: recognitionReviewDetailKeyV17_90L70(detail),
      sourceDescription,
      workSiteId: defaultWorkSiteId,
    };

    setFormItems((previous) => [
      nextItem,
      ...previous.filter(
        (item) =>
          item.serviceName.trim() ||
          item.unitPrice.trim() ||
          item.quantity.trim(),
      ),
    ]);
    setExpandedServiceItemKeys([newItemKey]);
    if (defaultWorkSiteId) {
      setActiveWorkSiteId(defaultWorkSiteId);
      setExpandedWorkSiteIds((previous) =>
        previous.includes(defaultWorkSiteId)
          ? previous
          : [defaultWorkSiteId, ...previous],
      );
      setMovingItemKey(null);
    } else {
      setExpandedWorkSiteIds((previous) =>
        previous.includes("__unassigned__")
          ? previous
          : ["__unassigned__", ...previous],
      );
      setMovingItemKey(selectableSites.length > 1 ? newItemKey : null);
    }
    setServiceActionMenuKey(null);
    toast.success("Leistung übernommen. Bitte prüfen und speichern.");
  };

  const discardRecognitionReviewDetailV17_90L70 = (
    detail?: RecognitionReviewPayloadV17_90L69 | null,
  ) => {
    const key = detail
      ? recognitionReviewDetailKeyV17_90L70(detail)
      : RECOGNITION_REVIEW_GENERIC_REASON_V17_90L69;
    setDiscardedRecognitionReviewKeys((previous) =>
      previous.includes(key) ? previous : [...previous, key],
    );
    toast.info("Vorschlag verworfen. Bitte Auftrag speichern.");
  };
  const addressRoleReviewCandidateV17_62 = (() => {
    const primarySite =
      formWorkSites.find((site) => Boolean(site.isPrimary)) ||
      formWorkSites[0] ||
      null;
    const extractedFallback =
      getExecutionAddressReviewCandidateFromOrderV17_90L38(currentEditOrder);
    const rawCandidate = {
      siteName:
        cleanWorkSiteDisplayName(primarySite?.siteName) ||
        cleanWorkSiteDisplayName(form.siteName) ||
        extractedFallback.siteName ||
        "",
      siteAddress:
        compactText(primarySite?.siteAddress) ||
        compactText(form.siteAddress) ||
        extractedFallback.siteAddress,
      sitePlz:
        compactText(primarySite?.sitePlz) ||
        compactText(form.sitePlz) ||
        extractedFallback.sitePlz,
      siteCity:
        compactText(primarySite?.siteCity) ||
        compactText(form.siteCity) ||
        extractedFallback.siteCity,
      siteNote:
        compactText(primarySite?.siteNote) ||
        compactText(form.siteNote) ||
        extractedFallback.siteNote,
    };
    const repairedCandidate =
      repairInlineAddressReviewCandidateV17_90L36(rawCandidate);
    const hasAny = Boolean(
      repairedCandidate.siteName ||
        repairedCandidate.siteAddress ||
        repairedCandidate.sitePlz ||
        repairedCandidate.siteCity ||
        repairedCandidate.siteNote,
    );
    const hasCompleteAddress = Boolean(
      repairedCandidate.siteAddress &&
        repairedCandidate.sitePlz &&
        repairedCandidate.siteCity,
    );

    const sameAsBillingAddress = Boolean(
      repairedCandidate.siteAddress &&
        repairedCandidate.sitePlz &&
        repairedCandidate.siteCity &&
        normalizeAddressPartForCompare(repairedCandidate.siteAddress) ===
          normalizeAddressPartForCompare(currentEditOrder?.customer?.address) &&
        normalizeAddressPartForCompare(repairedCandidate.sitePlz) ===
          normalizeAddressPartForCompare(currentEditOrder?.customer?.plz) &&
        normalizeAddressPartForCompare(repairedCandidate.siteCity) ===
          normalizeAddressPartForCompare(currentEditOrder?.customer?.city),
    );

    return {
      ...repairedCandidate,
      hasAny,
      hasCompleteAddress,
      sameAsBillingAddress,
    };
  })();

  const currentBillingCustomerV17_90L36 =
    customers.find((customer: Customer) => customer.id === form.customerId) ||
    currentEditOrder?.customer ||
    null;
  const hasLinkedExistingBillingCustomerV17_90L36 = Boolean(
    form.customerId && currentBillingCustomerV17_90L36?.customerNumber,
  );

  const isSameAddressPartsV17_63 = (
    left: {
      siteAddress?: string | null;
      sitePlz?: string | null;
      siteCity?: string | null;
    },
    right: {
      siteAddress?: string | null;
      sitePlz?: string | null;
      siteCity?: string | null;
    },
  ) => {
    const leftStreet = normalizeAddressPartForCompare(left.siteAddress);
    const leftPlz = normalizeAddressPartForCompare(left.sitePlz);
    const leftCity = normalizeAddressPartForCompare(left.siteCity);
    const rightStreet = normalizeAddressPartForCompare(right.siteAddress);
    const rightPlz = normalizeAddressPartForCompare(right.sitePlz);
    const rightCity = normalizeAddressPartForCompare(right.siteCity);

    return Boolean(
      leftStreet &&
      leftPlz &&
      leftCity &&
      rightStreet &&
      rightPlz &&
      rightCity &&
      leftStreet === rightStreet &&
      leftPlz === rightPlz &&
      leftCity === rightCity,
    );
  };
  const isAddressRoleReviewAlreadyAssignedV17_90K = (() => {
    if (!currentEditOrder || !addressRoleReviewCandidateV17_62.hasCompleteAddress) return false;

    const candidate = {
      siteAddress: addressRoleReviewCandidateV17_62.siteAddress,
      sitePlz: addressRoleReviewCandidateV17_62.sitePlz,
      siteCity: addressRoleReviewCandidateV17_62.siteCity,
    };

    const formPrimarySite =
      formWorkSites.find((site) => Boolean(site.isPrimary)) ||
      formWorkSites[0] ||
      null;

    const storedCandidates = [
      formPrimarySite
        ? {
            siteAddress: formPrimarySite.siteAddress,
            sitePlz: formPrimarySite.sitePlz,
            siteCity: formPrimarySite.siteCity,
          }
        : null,
      {
        siteAddress: form.siteAddress,
        sitePlz: form.sitePlz,
        siteCity: form.siteCity,
      },
      ...((currentEditOrder.workSites || []).map((site) => ({
        siteAddress: site.siteAddress,
        sitePlz: site.sitePlz,
        siteCity: site.siteCity,
      })) as Array<{
        siteAddress?: string | null;
        sitePlz?: string | null;
        siteCity?: string | null;
      }>),
      {
        siteAddress: currentEditOrder.siteAddress,
        sitePlz: currentEditOrder.sitePlz,
        siteCity: currentEditOrder.siteCity,
      },
    ].filter(Boolean) as Array<{
      siteAddress?: string | null;
      sitePlz?: string | null;
      siteCity?: string | null;
    }>;

    return storedCandidates.some((stored) =>
      isSameAddressPartsV17_63(candidate, stored),
    );
  })();

  const shouldShowAddressRoleReviewBoxV17_62 = Boolean(
    currentEditOrder &&
    hasAddressRoleReviewReasonV17_61(currentEditOrder) &&
    !hasCompleteSameExecutionAddressAsCustomerV17_90L28(currentEditOrder) &&
    !isAddressRoleReviewAlreadyAssignedV17_90K,
  );
  const hasCurrentEditCurrencyReview = hasAnyCurrencyReviewReason(
    currentEditReviewReasons,
  );
  const hasCurrentEditItemCurrencyMismatch = hasItemLevelCurrencyReviewReasons(
    currentEditReviewReasons,
  );
  const hasOnlyGlobalCurrentEditCurrencyReview =
    hasGlobalCurrencyReviewWithoutItemDetails(currentEditReviewReasons);

  const hasFormItemCurrencyMismatch = (item: { serviceName?: string | null }) =>
    hasCurrencyMismatchReviewForService(
      currentEditReviewReasons,
      item.serviceName,
    );

  const isAddressRoleReviewReasonCurrentV17_64 = (reason: string) =>
    reason === "address_role_uncertain" ||
    reason === "customer_address_quarantined_ambiguous_role_v17_61" ||
    reason === "execution_address_incomplete" ||
    reason === "intake_risk:execution_address_incomplete" ||
    reason.startsWith("intake_address:");

  const removeAddressRoleReviewReasonsV17_64 = (reasons: string[] = []) =>
    reasons.filter((reason) => !isAddressRoleReviewReasonCurrentV17_64(reason));

  const blankWorkSitesForClearedExecutionAddressV17_64 = (
    sites: OrderWorkSite[],
  ): OrderWorkSite[] =>
    sites.map((site, index) => ({
      ...site,
      siteName: null,
      siteAddress: null,
      sitePlz: null,
      siteCity: null,
      siteNote: null,
      isPrimary: index === 0,
      sortOrder: index,
    }));

  const persistAddressReviewPatchV17_64 = async (
    formPatch: Partial<typeof form>,
    workSitesPatch?: OrderWorkSite[],
    options?: { resolveAddressReview?: boolean },
  ): Promise<Order | null> => {
    if (!editId) return null;

    const nextReviewReasons = options?.resolveAddressReview
      ? removeAddressRoleReviewReasonsV17_64(currentEditReviewReasons)
      : [...currentEditReviewReasons];
    const payload: any = {
      ...formPatch,
      reviewReasons: nextReviewReasons,
      needsReview: nextReviewReasons.length > 0,
    };

    if (workSitesPatch) {
      payload.workSites = workSitesPatch.map((site, index) => ({
        id: site.id,
        siteName: cleanWorkSiteDisplayName(site.siteName) || null,
        siteAddress: site.siteAddress?.trim() || null,
        sitePlz: site.sitePlz?.trim() || null,
        siteCity: site.siteCity?.trim() || null,
        siteNote: site.siteNote?.trim() || null,
        isPrimary: Boolean(site.isPrimary) || index === 0,
        sortOrder: Number.isFinite(Number(site.sortOrder))
          ? Number(site.sortOrder)
          : index,
      }));
    }

    const res = await fetch(`/api/orders/${editId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      toast.error("Adressprüfung konnte nicht gespeichert werden");
      return null;
    }

    const saved = await res.json();
    setOrders((prev) =>
      prev.map((order) =>
        order.id === saved.id ? { ...order, ...saved } : order,
      ),
    );
    await load();
    return saved;
  };

  const applyAddressReviewAsBillingV17_62 = () => {
    const candidate = addressRoleReviewCandidateV17_62;
    if (!candidate.hasAny) {
      toast.error("Keine erkannte Adresse zum Übernehmen vorhanden.");
      return;
    }
    if (hasLinkedExistingBillingCustomerV17_90L36) {
      toast.error(
        "Ein bestehender Kunde ist bereits zugeordnet. Die Rechnungsadresse bitte nur über Kunde bearbeiten ändern.",
      );
      return;
    }

    const currentCustomer =
      customers.find((c: Customer) => c.id === form.customerId) || null;
    const orderCustomer = currentEditOrder?.customer || null;
    const rawName = compactText(currentCustomer?.name || orderCustomer?.name);
    const safeName =
      rawName &&
      !isFallbackCustomerName(rawName) &&
      !/^[-–—]$/.test(rawName) &&
      !/^name fehlt$/i.test(rawName)
        ? rawName
        : "";

    setNewCust({
      name: safeName,
      phone: compactText(currentCustomer?.phone || orderCustomer?.phone),
      email: compactText(currentCustomer?.email || orderCustomer?.email),
      address: candidate.siteAddress,
      plz: candidate.sitePlz,
      city: candidate.siteCity,
      country: currentCustomer?.country || "CH",
    });

    const currentExecutionAddress = {
      siteAddress: form.siteAddress,
      sitePlz: form.sitePlz,
      siteCity: form.siteCity,
    };
    const candidateAddress = {
      siteAddress: candidate.siteAddress,
      sitePlz: candidate.sitePlz,
      siteCity: candidate.siteCity,
    };
    const clearDuplicateExecutionAddress = isSameAddressPartsV17_63(
      currentExecutionAddress,
      candidateAddress,
    );

    if (clearDuplicateExecutionAddress) {
      const clearedWorkSites =
        blankWorkSitesForClearedExecutionAddressV17_64(formWorkSites);
      setForm((prev) => ({
        ...prev,
        siteAddressDifferent: false,
        siteName: "",
        siteAddress: "",
        sitePlz: "",
        siteCity: "",
        siteNote: "",
      }));
      setFormWorkSites(clearedWorkSites);
      setFormItems((prev) =>
        prev.map((item) => ({
          ...item,
          workSiteId: null,
        })),
      );
      setActiveWorkSiteId(null);
      setExpandedWorkSiteIds([]);
    }
    setPendingBillingAddressRoleAutoSaveV17_64(true);

    setEditingCustomer(Boolean(form.customerId));
    setShowNewCustomer(true);
    setDupCheckOpen(false);
    setSiteAddressEditing(false);
    window.setTimeout(() => {
      customerEditorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 40);
    toast.info(
      "Rechnungsadresse vorbereitet. Namen ergänzen und Kunde aktualisieren – der Auftrag wird danach automatisch gespeichert.",
    );
  };

  const editAddressReviewSuggestionV17_90L94 = () => {
    const candidate = addressRoleReviewCandidateV17_62;
    const existingSite =
      formWorkSites.find((site) => Boolean(site.isPrimary)) ||
      formWorkSites[0] ||
      null;
    const siteId = existingSite?.id || `local-site-${Date.now().toString(36)}`;
    const nextSite: OrderWorkSite = {
      ...(existingSite || {}),
      id: siteId,
      siteName:
        cleanWorkSiteDisplayName(candidate.siteName) ||
        cleanWorkSiteDisplayName(existingSite?.siteName) ||
        null,
      siteAddress:
        compactText(candidate.siteAddress) ||
        compactText(existingSite?.siteAddress) ||
        null,
      sitePlz:
        compactText(candidate.sitePlz) ||
        compactText(existingSite?.sitePlz) ||
        null,
      siteCity:
        compactText(candidate.siteCity) ||
        compactText(existingSite?.siteCity) ||
        null,
      siteNote:
        compactText(candidate.siteNote) ||
        compactText(existingSite?.siteNote) ||
        null,
      isPrimary: true,
      sortOrder: 0,
    };
    const nextWorkSites = existingSite
      ? formWorkSites.map((site) =>
          site.id === existingSite.id
            ? nextSite
            : { ...site, isPrimary: false },
        )
      : [nextSite];

    setForm((prev) => ({
      ...prev,
      siteAddressDifferent: true,
      siteName: cleanWorkSiteDisplayName(nextSite.siteName) || "",
      siteAddress: nextSite.siteAddress || "",
      sitePlz: nextSite.sitePlz || "",
      siteCity: nextSite.siteCity || "",
      siteNote: nextSite.siteNote || "",
    }));
    setFormWorkSites(nextWorkSites);
    setFormItems((prev) =>
      prev.map((item) => ({
        ...item,
        workSiteId: item.workSiteId || siteId,
      })),
    );
    setActiveWorkSiteId(siteId);
    setExpandedWorkSiteIds((prev) =>
      prev.includes(siteId) ? prev : [siteId, ...prev],
    );
    setSiteAddressEditing(true);
    window.setTimeout(() => {
      executionAddressRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 40);
    toast.info(
      candidate.hasAny
        ? "Adressvorschlag geöffnet. Bitte kontrollieren und ausdrücklich übernehmen."
        : "Ausführungsadresse geöffnet. Bitte manuell eintragen und ausdrücklich speichern.",
    );
  };

  const applyAddressReviewAsExecutionV17_62 = async () => {
    const candidate = addressRoleReviewCandidateV17_62;
    if (!candidate.hasAny) {
      toast.error("Keine erkannte Adresse zum Übernehmen vorhanden.");
      return;
    }

    const existingSite =
      formWorkSites.find((site) => Boolean(site.isPrimary)) ||
      formWorkSites[0] ||
      null;
    const siteId = existingSite?.id || `local-site-${Date.now().toString(36)}`;
    const nextSite: OrderWorkSite = {
      ...(existingSite || {}),
      id: siteId,
      siteName: cleanWorkSiteDisplayName(candidate.siteName) || null,
      siteAddress: candidate.siteAddress || null,
      sitePlz: candidate.sitePlz || null,
      siteCity: candidate.siteCity || null,
      siteNote: candidate.siteNote || null,
      isPrimary: true,
      sortOrder: 0,
    };
    const nextWorkSites = existingSite
      ? formWorkSites.map((site) =>
          site.id === existingSite.id
            ? nextSite
            : { ...site, isPrimary: false },
        )
      : [nextSite];
    const nextFormPatch = {
      siteAddressDifferent: true,
      siteName: cleanWorkSiteDisplayName(nextSite.siteName) || "",
      siteAddress: nextSite.siteAddress || "",
      sitePlz: nextSite.sitePlz || "",
      siteCity: nextSite.siteCity || "",
      siteNote: nextSite.siteNote || "",
    };

    setForm((prev) => ({
      ...prev,
      ...nextFormPatch,
    }));
    setFormWorkSites(nextWorkSites);
    setFormItems((prev) =>
      prev.map((item) => ({
        ...item,
        workSiteId: item.workSiteId || siteId,
      })),
    );
    setActiveWorkSiteId(siteId);
    setExpandedWorkSiteIds((prev) =>
      prev.includes(siteId) ? prev : [siteId, ...prev],
    );
    const hasCompleteExecutionAddress = Boolean(
      nextSite.siteAddress && nextSite.sitePlz && nextSite.siteCity,
    );
    setSiteAddressEditing(!hasCompleteExecutionAddress);

    setSaving(true);
    try {
      const saved = await persistAddressReviewPatchV17_64(
        nextFormPatch,
        nextWorkSites,
        { resolveAddressReview: hasCompleteExecutionAddress },
      );
      if (saved) {
        if (hasCompleteExecutionAddress) {
          toast.success("Ausführungsadresse übernommen und gespeichert.");
        } else {
          toast.info(
            "Ausführungsadresse übernommen. Bitte Strasse, PLZ und Ort vollständig ergänzen.",
          );
          window.setTimeout(() => {
            executionAddressRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }, 40);
        }
      }
    } catch {
      toast.error("Adressprüfung konnte nicht gespeichert werden");
    } finally {
      setSaving(false);
    }
  };

  const discardAddressReviewSuggestionV17_90L36D = async () => {
    if (!editId) return;

    const clearedWorkSites =
      blankWorkSitesForClearedExecutionAddressV17_64(formWorkSites);
    const nextFormPatch = {
      siteAddressDifferent: false,
      siteName: "",
      siteAddress: "",
      sitePlz: "",
      siteCity: "",
      siteNote: "",
    };

    setForm((prev) => ({ ...prev, ...nextFormPatch }));
    setFormWorkSites(clearedWorkSites);
    setFormItems((prev) =>
      prev.map((item) => ({ ...item, workSiteId: null })),
    );
    setSiteAddressEditing(false);
    setActiveWorkSiteId(null);
    setExpandedWorkSiteIds([]);

    setSaving(true);
    try {
      const saved = await persistAddressReviewPatchV17_64(
        nextFormPatch,
        clearedWorkSites,
        { resolveAddressReview: true },
      );
      if (saved) {
        toast.success(
          "Vorschlag verworfen. Die Rechnungsadresse bleibt unverändert.",
        );
      }
    } catch {
      toast.error("Adressvorschlag konnte nicht verworfen werden");
    } finally {
      setSaving(false);
    }
  };

  const isBlockingCurrencyReviewText = (value?: string | null) => {
    const text = normalizeForMatch(value);
    if (!text) return false;

    return (
      text.includes("waehrung preis noch nicht bestaetigt") ||
      text.includes("wahrung preis noch nicht bestatigt") ||
      text.includes("waehrung") ||
      text.includes("wahrung") ||
      text.includes("currency") ||
      text.includes("preis fehlt") ||
      text.includes("preis im text unklar") ||
      text.includes("price unclear") ||
      text.includes("price missing") ||
      text.includes("nicht in netto") ||
      text.includes("nicht in mwst") ||
      text.includes("nicht in total")
    );
  };

  const isCompleteResolvedFormItem = (
    item: Pick<FormItem, "serviceName" | "unit" | "unitPrice" | "quantity">,
  ) => {
    const unitText = normalizeForMatch(item.unit);
    return (
      String(item.serviceName || "").trim().length > 0 &&
      unitText.length > 0 &&
      !unitText.includes("pruefen") &&
      !unitText.includes("prufen") &&
      Number(item.unitPrice || 0) > 0 &&
      Number(item.quantity || 0) > 0
    );
  };

  const isManuallyConfirmedCurrencyItem = (item: FormItem) => {
    if (!isCompleteResolvedFormItem(item)) return false;

    // V17.90L36c: Beim Öffnen wird ein alter Bestätigungsmarker für eine noch
    // immer fehlerhafte Position bewusst nicht übernommen. Setzt der Nutzer
    // danach Preis/Einheit/Menge/Leistung neu, wird manualCurrencyConfirmed in
    // dieser Sitzung erneut gesetzt und genau diese Position darf aufgelöst
    // werden. Eine reine Katalogbestätigung löst keinen Währungsfehler.
    if (hasFormItemCurrencyMismatch(item)) {
      return Boolean(item.manualCurrencyConfirmed);
    }

    if (
      Boolean(item.manualCurrencyConfirmed) ||
      Boolean(item.catalogReviewConfirmed)
    ) {
      return true;
    }

    return !isBlockingCurrencyReviewText(item.aiWarning);
  };

  const isEditableCurrencyReviewPlaceholderV17_90L37 = (item: FormItem) =>
    isBlockingCurrencyReviewText(item.aiWarning) &&
    (isInternalReviewServiceName(item.serviceName) ||
      Number(item.unitPrice || 0) <= 0);

  const hasConfirmedCurrencyReviewItemV17_90L38 = formItems.some(
    (item) =>
      Boolean(item.manualCurrencyConfirmed) &&
      isCompleteResolvedFormItem(item),
  );
  const hasEditableCurrencyReviewItemV17_90L38 = formItems.some(
    (item) =>
      hasFormItemCurrencyMismatch(item) ||
      isEditableCurrencyReviewPlaceholderV17_90L37(item),
  );
  const hasResidualCurrencyReviewWithoutEditableItemV17_90L38 = Boolean(
    hasCurrentEditCurrencyReview &&
      !hasCurrentEditItemCurrencyMismatch &&
      !hasEditableCurrencyReviewItemV17_90L38 &&
      !hasConfirmedCurrencyReviewItemV17_90L38,
  );

  // V17.90L38: Ein unsichtbarer globaler Währungshinweis wird nicht mehr
  // automatisch entfernt. Ohne bearbeitbare Prüfposition braucht es die
  // ausdrückliche Bestätigung "Geprüft und verstanden". Eine bewusst aus dem
  // Katalog gewählte und dadurch bestätigte Position löst den Hinweis direkt.
  const formHasResolvedCurrencyReview =
    hasCurrentEditCurrencyReview &&
    !hasCurrentEditItemCurrencyMismatch &&
    (currency === "CHF" || currency === "EUR") &&
    !hasEditableCurrencyReviewItemV17_90L38 &&
    (hasConfirmedCurrencyReviewItemV17_90L38 ||
      manualResidualCurrencyAcknowledged);

  const hasEditCurrencyReview =
    hasCurrentEditCurrencyReview && !formHasResolvedCurrencyReview;

  const isFormItemBlockedByCurrencyReview = (item: FormItem) => {
    if (!hasCurrentEditCurrencyReview) return false;
    if (isManuallyConfirmedCurrencyItem(item)) return false;
    if (hasFormItemCurrencyMismatch(item)) return true;
    if (hasOnlyGlobalCurrentEditCurrencyReview) {
      return isEditableCurrencyReviewPlaceholderV17_90L37(item);
    }
    return false;
  };

  const isFormItemBlockedByPriceContradictionV17_90L234 = (
    item: FormItem,
  ) =>
    Boolean(
      !item.manualCurrencyConfirmed &&
        findPriceContradictionReviewForServiceV17_90L234(
          currentEditReviewReasons,
          item.serviceName,
        ),
    );

  const isBlockedFormItemForTotal = (
    item: Pick<
      FormItem,
      "unit" | "unitPrice" | "quantity" | "aiWarning" | "catalogReviewConfirmed"
    > & {
      serviceName?: string | null;
    },
    forceCurrencyConflict = false,
  ) => {
    if (
      forceCurrencyConflict ||
      (Boolean((item as FormItem).pendingManualReviewDecision) &&
        !Boolean((item as FormItem).manualReviewConfirmed)) ||
      isFormItemBlockedByCurrencyReview(item as FormItem) ||
      isFormItemBlockedByPriceContradictionV17_90L234(item as FormItem)
    ) {
      return true;
    }

    const unitReviewValue = normalizeForMatch(item.unit || "");
    const reviewText = normalizeForMatch(
      [item.unit, item.aiWarning].filter(Boolean).join(" "),
    );

    return (
      isInternalReviewServiceName(item.serviceName) ||
      unitReviewValue === "pruefen" ||
      unitReviewValue === "prufen" ||
      unitReviewValue.includes("einheit pruefen") ||
      unitReviewValue.includes("einheit prufen") ||
      reviewText.includes("einheit pruefen") ||
      reviewText.includes("einheit prufen") ||
      reviewText.includes("einheit fehlt") ||
      reviewText.includes("unit missing") ||
      reviewText.includes("preis pruefen") ||
      reviewText.includes("preis prufen") ||
      reviewText.includes("preis fehlt") ||
      reviewText.includes("menge pruefen") ||
      reviewText.includes("menge prufen") ||
      reviewText.includes("menge fehlt")
    );
  };

  const getSafeFormItemTotal = (
    item: Pick<
      FormItem,
      | "serviceName"
      | "unit"
      | "unitPrice"
      | "quantity"
      | "aiWarning"
      | "catalogReviewConfirmed"
    >,
    forceCurrencyConflict = false,
  ) => {
    if (isBlockedFormItemForTotal(item, forceCurrencyConflict)) return 0;
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    return quantity > 0 && unitPrice > 0 ? quantity * unitPrice : 0;
  };

  const itemsTotal = formItems.reduce(
    (sum, item) => sum + getSafeFormItemTotal(item),
    0,
  );

  const totalWithVat = itemsTotal + (itemsTotal * orderVatRate) / 100;

  const hasWorkSiteContent = (site?: OrderWorkSite | null) =>
    Boolean(
      compactText(site?.siteName) ||
      compactText(site?.siteAddress) ||
      compactText(site?.sitePlz) ||
      compactText(site?.siteCity) ||
      compactText(site?.siteNote),
    );

  const hasItemsAssignedToWorkSite = (siteId?: string | null) =>
    Boolean(siteId) && formItems.some((item) => item.workSiteId === siteId);

  const currentEditWorkSites = formWorkSites
    .filter(
      (site) =>
        hasWorkSiteContent(site) ||
        hasItemsAssignedToWorkSite(site.id) ||
        site.id === editingWorkSiteId ||
        site.id === activeWorkSiteId,
    )
    .slice()
    .sort((a, b) => {
      // V17.90L284: Ein neu angelegter Arbeitsort bleibt bis zum Abschluss
      // immer oben sichtbar. Bestehende Primär-/Sortierreihenfolge bleibt danach erhalten.
      const aIsOpenDraft = a.id === editingWorkSiteId && a.id.startsWith("tmp-");
      const bIsOpenDraft = b.id === editingWorkSiteId && b.id.startsWith("tmp-");
      if (aIsOpenDraft !== bIsOpenDraft) return aIsOpenDraft ? -1 : 1;
      return (
        Number(b.isPrimary ? 1 : 0) - Number(a.isPrimary ? 1 : 0) ||
        Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
      );
    });

  const hasMultipleEditWorkSites = currentEditWorkSites.length > 1;
  const currentEditWorkSiteGroupKeysV17_90L290 = [
    ...(formItems.some((item) => !item.workSiteId) ? ["__unassigned__"] : []),
    ...currentEditWorkSites.map((site) => site.id),
  ];
  const allEditWorkSiteGroupsExpandedV17_90L290 =
    currentEditWorkSiteGroupKeysV17_90L290.length > 0 &&
    currentEditWorkSiteGroupKeysV17_90L290.every((key) =>
      expandedWorkSiteIds.includes(key),
    );

  const currentEditSystemBadges = currentEditOrder
    ? getSystemBadges(currentEditOrder, services)
    : [];
  const currentEditExecutionHeaderBadge =
    currentEditSystemBadges.find((badge) => badge.key === "site_address") ||
    currentEditSystemBadges.find((badge) => badge.key === "address_review") ||
    (currentEditOrder && hasMultipleEditWorkSites
      ? {
          key: "site_address",
          label: `Ausführungsorte · ${currentEditWorkSites.length}`,
          className: "bg-cyan-50 text-cyan-800 border border-cyan-300",
          tooltip: formatExecutionAddressTooltip(currentEditOrder),
        }
      : null);
  const currentEditMergedHeaderBadge = currentEditSystemBadges.find(
    (badge) => badge.key === "merged",
  );

  const normalizeWorkSiteText = (value?: string | null) =>
    compactText(value).toLowerCase();

  const escapeWorkSiteRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const stripDuplicateAddressFromSiteTitle = (
    titleValue?: string | null,
    addressValue?: string | null,
  ) => {
    let title = compactText(titleValue);
    const address = compactText(addressValue);
    if (!title) return "";
    if (!address) return title;

    const escapedAddress = escapeWorkSiteRegExp(address);
    title = title
      .replace(new RegExp(`\\s*[·,;-]\\s*${escapedAddress}\\s*$`, "i"), "")
      .replace(new RegExp(`\\s+${escapedAddress}\\s*$`, "i"), "")
      .replace(/\s*[·,;-]\s*$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return title;
  };

  const formatWorkSiteTitle = (site?: OrderWorkSite | null) => {
    if (!site) return "Ausführungsort";
    return (
      stripDuplicateAddressFromSiteTitle(site.siteName, site.siteAddress) ||
      compactText(site.siteAddress) ||
      "Ausführungsort"
    );
  };

  const formatWorkSiteAddress = (site?: OrderWorkSite | null) => {
    if (!site) return "";
    const titleKey = normalizeWorkSiteText(site.siteName);
    const address = compactText(site.siteAddress);
    const addressKey = normalizeWorkSiteText(site.siteAddress);
    return [
      address && addressKey !== titleKey ? address : "",
      [site.sitePlz, site.siteCity].map(compactText).filter(Boolean).join(" "),
      compactText(site.siteNote),
    ]
      .filter(Boolean)
      .join(" · ");
  };

  const getWorkSiteItems = (siteId?: string | null) =>
    formItems.filter((item) => item.workSiteId && item.workSiteId === siteId);

  const getWorkSiteTotal = (siteId?: string | null) =>
    getWorkSiteItems(siteId).reduce(
      (sum, item) => sum + getSafeFormItemTotal(item),
      0,
    );

  const updateFormWorkSite = (
    siteId: string,
    field: keyof OrderWorkSite,
    value: string | boolean | number | null,
  ) => {
    setFormWorkSites((prev) =>
      prev.map((site) =>
        site.id === siteId ? { ...site, [field]: value } : site,
      ),
    );
  };

  const focusFormWorkSiteEditorV17_90L284 = (siteId: string) => {
    requestAnimationFrame(() => {
      serviceItemsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      window.setTimeout(() => {
        serviceItemsRef.current
          ?.querySelector<HTMLInputElement>(
            `[data-work-site-editor-id="${siteId}"] input`,
          )
          ?.focus();
      }, 180);
    });
  };

  const addFormWorkSite = () => {
    const unfinishedDraft = formWorkSites.find((site) => {
      const assigned = formItems.filter((item) => item.workSiteId === site.id);
      return (
        !hasWorkSiteContent(site) ||
        assigned.some((item) => !String(item.serviceName || "").trim())
      );
    });

    if (unfinishedDraft) {
      setEditingWorkSiteId(unfinishedDraft.id);
      setActiveWorkSiteId(unfinishedDraft.id);
      setNewItemWorkSiteId(unfinishedDraft.id);
      setExpandedWorkSiteIds((prev) =>
        prev.includes(unfinishedDraft.id)
          ? prev
          : [unfinishedDraft.id, ...prev],
      );
      const unfinishedItem = formItems.find(
        (item) =>
          item.workSiteId === unfinishedDraft.id &&
          !String(item.serviceName || "").trim(),
      );
      if (unfinishedItem) {
        setExpandedServiceItemKeys([unfinishedItem.key]);
      }
      focusFormWorkSiteEditorV17_90L284(unfinishedDraft.id);
      toast.info("Neuen Arbeitsort und Leistung zuerst vollständig ausfüllen.");
      return;
    }

    const currentPrimary =
      formWorkSites.find((site) => Boolean(site.isPrimary)) ||
      formWorkSites[0] ||
      null;
    const primaryId =
      currentPrimary?.id || `local-site-${editId || Date.now().toString(36)}`;
    const hasVisiblePrimaryAddress = Boolean(
      form.siteAddressDifferent &&
        [form.siteName, form.siteAddress, form.sitePlz, form.siteCity, form.siteNote]
          .map((value) => compactText(value))
          .some(Boolean),
    );
    const baseSites = hasVisiblePrimaryAddress
      ? currentPrimary
        ? formWorkSites.map((site, index) =>
            site.id === currentPrimary.id
              ? {
                  ...site,
                  siteName: isSameAddressPlaceholderV17_90L135H(form.siteName)
                    ? ""
                    : cleanWorkSiteDisplayName(form.siteName) || "",
                  siteAddress: form.siteAddress || "",
                  sitePlz: form.sitePlz || "",
                  siteCity: form.siteCity || "",
                  siteNote: form.siteNote || "",
                  isPrimary: true,
                  sortOrder: 0,
                }
              : { ...site, isPrimary: false, sortOrder: Math.max(1, index) },
          )
        : [
            {
              id: primaryId,
              siteName: isSameAddressPlaceholderV17_90L135H(form.siteName)
                ? ""
                : cleanWorkSiteDisplayName(form.siteName) || "",
              siteAddress: form.siteAddress || "",
              sitePlz: form.sitePlz || "",
              siteCity: form.siteCity || "",
              siteNote: form.siteNote || "",
              isPrimary: true,
              sortOrder: 0,
            },
          ]
      : formWorkSites;

    const existingAssignmentSiteId =
      baseSites.find((site) => Boolean(site.isPrimary))?.id ||
      baseSites[0]?.id ||
      null;
    const newId = `tmp-${Math.random().toString(36).slice(2)}`;
    const assignmentForExistingItems = existingAssignmentSiteId || newId;
    const blankItem = {
      ...createEmptyItem(),
      workSiteId: newId,
    };

    // V17.90L285: Sobald aus einem Einzel-Arbeitsort ein Multi-Site-Auftrag
    // wird, erhalten alle bisherigen Leistungen zuerst den bisherigen Ort.
    // Nur die neu erzeugte leere Leistung gehört zum neuen Arbeitsort.
    setFormItems((prev) => [
      blankItem,
      ...prev.map((item) => ({
        ...item,
        workSiteId: item.workSiteId || assignmentForExistingItems,
      })),
    ]);
    setExpandedServiceItemKeys([blankItem.key]);

    setForm((prev) => ({ ...prev, siteAddressDifferent: true }));
    setSiteAddressEditing(false);
    setFormWorkSites([
      {
        id: newId,
        siteName: "",
        siteAddress: "",
        sitePlz: "",
        siteCity: "",
        siteNote: "",
        isPrimary: baseSites.length === 0,
        sortOrder: baseSites.length,
      },
      ...baseSites,
    ]);
    setEditingWorkSiteId(newId);
    setActiveWorkSiteId(newId);
    setNewItemWorkSiteId(newId);
    setExpandedWorkSiteIds((prev) =>
      prev.includes(newId) ? prev : [newId, ...prev],
    );
    setMovingItemKey(null);
    focusFormWorkSiteEditorV17_90L284(newId);
  };

  const setOrderExecutionAddressEnabledV17_90L288 = (checked: boolean) => {
    if (!checked && formWorkSites.length > 1) {
      toast.error(
        "Mehrere Arbeitsorte können nur einzeln bearbeitet werden.",
      );
      return;
    }

    setExecutionAddressClearRequested(!checked);

    if (!checked) {
      setSiteAddressEditing(false);
      setForm((prev) => ({
        ...prev,
        siteAddressDifferent: false,
        siteName: "",
        siteAddress: "",
        sitePlz: "",
        siteCity: "",
        siteNote: "",
      }));
      setFormWorkSites([]);
      setFormItems((prev) =>
        prev.map((item) => ({
          ...item,
          workSiteId: null,
          workSite: null,
        })),
      );
      setEditingWorkSiteId(null);
      setActiveWorkSiteId(null);
      setNewItemWorkSiteId("");
      setExpandedWorkSiteIds([]);
      return;
    }

    setSiteAddressEditing(true);
    setForm((prev) => {
      const hasCompleteStoredExecutionAddress = Boolean(
        compactText(prev.siteAddress) &&
          compactText(prev.sitePlz) &&
          compactText(prev.siteCity),
      );
      const mustStartBlank =
        !hasCompleteStoredExecutionAddress ||
        isSameAddressPlaceholderV17_90L135H(prev.siteName) ||
        isSameAddressPlaceholderV17_90L135H(prev.siteCity);
      return {
        ...prev,
        siteAddressDifferent: true,
        ...(mustStartBlank
          ? {
              siteName: "",
              siteAddress: "",
              sitePlz: "",
              siteCity: "",
              siteNote: "",
            }
          : {}),
      };
    });
  };

  const removeFormWorkSite = async (siteId: string) => {
    const assignedItems = formItems.filter(
      (item) => item.workSiteId === siteId,
    );
    const hasRealItems = assignedItems.some((item) =>
      Boolean(
        String(item.serviceName || "").trim() ||
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

    const nextItems = formItems.filter((item) => item.workSiteId !== siteId);
    const nextWorkSites = formWorkSites.filter((site) => site.id !== siteId);

    setFormItems(nextItems);
    setFormWorkSites(nextWorkSites);
    setEditingWorkSiteId((prev) => (prev === siteId ? null : prev));
    setActiveWorkSiteId((prev) => (prev === siteId ? null : prev));
    setNewItemWorkSiteId((prev) => (prev === siteId ? "" : prev));
    setExpandedWorkSiteIds((prev) => prev.filter((entry) => entry !== siteId));

    if (!editId) return;
    setSaving(true);
    try {
      const saved = await saveOrder(
        undefined,
        nextItems,
        undefined,
        undefined,
        nextWorkSites,
        nextWorkSites.length === 0,
      );
      if (!saved) return;
      setOrders((previous) =>
        previous.map((order) =>
          order.id === saved.id ? { ...order, ...saved } : order,
        ),
      );
      await load();
      toast.success("Arbeitsort gelöscht und gespeichert.");
    } catch {
      toast.error("Arbeitsort konnte nicht gelöscht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  const getWorkSiteSelectLabel = (site: OrderWorkSite) => {
    const title = formatWorkSiteTitle(site);
    const address = formatWorkSiteAddress(site);
    return [title, address].filter(Boolean).join(" · ") || "Arbeitsort prüfen";
  };

  const normalizePersistentExecutionAddressKeyV17_68 = (site: {
    siteName?: string | null;
    siteAddress?: string | null;
    sitePlz?: string | null;
    siteCity?: string | null;
  }) =>
    [
      normalizeAddressPartForCompare(site.siteName),
      normalizeAddressPartForCompare(site.siteAddress),
      normalizeAddressPartForCompare(site.sitePlz),
      normalizeAddressPartForCompare(site.siteCity),
    ].join("|");

  const currentExecutionAddressSavedInCustomerV17_73 = useMemo(() => {
    if (!form.customerId || !form.siteAddressDifferent) return null;

    const currentAddress = {
      siteAddress: form.siteAddress,
      sitePlz: form.sitePlz,
      siteCity: form.siteCity,
    };

    if (
      !currentAddress.siteAddress ||
      !currentAddress.sitePlz ||
      !currentAddress.siteCity
    ) {
      return null;
    }

    const customer = customers.find((entry) => entry.id === form.customerId);
    const storedAddresses =
      customer && Array.isArray(customer.executionAddresses)
        ? customer.executionAddresses
        : [];

    return (
      storedAddresses.find((stored) =>
        isSameAddressPartsV17_63(stored, currentAddress),
      ) || null
    );
  }, [
    customers,
    form.customerId,
    form.siteAddressDifferent,
    form.siteAddress,
    form.sitePlz,
    form.siteCity,
  ]);

  const currentExecutionAddressCustomerV17_90L211 = customers.find(
    (entry: Customer) => entry.id === form.customerId,
  );
  const showFirstTimeExecutionAddressSavedNoticeV17_73 = Boolean(
    currentExecutionAddressSavedInCustomerV17_73 &&
      String(
        currentExecutionAddressCustomerV17_90L211?.customerNumber || "",
      ).trim() &&
      Number(currentExecutionAddressSavedInCustomerV17_73.usageCount || 0) <= 1,
  );

  const previousExecutionAddressSuggestionsV17_68 = useMemo(() => {
    if (!form.customerId) return [] as OrderWorkSite[];

    const customer = customers.find((entry) => entry.id === form.customerId);
    const storedAddresses =
      customer && Array.isArray(customer.executionAddresses)
        ? customer.executionAddresses
        : [];

    const seen = new Set<string>();
    const suggestions: OrderWorkSite[] = [];
    const usedAddressKeys = new Set<string>();

    const registerUsedAddress = (site: {
      siteAddress?: string | null;
      sitePlz?: string | null;
      siteCity?: string | null;
    }) => {
      const key = normalizePersistentExecutionAddressKeyV17_68(site);
      if (key && key !== "||") usedAddressKeys.add(key);
    };

    formWorkSites.forEach(registerUsedAddress);
    registerUsedAddress({
      siteAddress: form.siteAddress,
      sitePlz: form.sitePlz,
      siteCity: form.siteCity,
    });

    storedAddresses
      .slice()
      .sort((a, b) => {
        const bTime = new Date(b.lastUsedAt || 0).getTime();
        const aTime = new Date(a.lastUsedAt || 0).getTime();
        return bTime - aTime;
      })
      .forEach((stored, index) => {
        const normalizedSite: OrderWorkSite = {
          id: `customer-execution-${stored.id || index}`,
          customerExecutionAddressId: stored.id || null,
          siteName: cleanWorkSiteDisplayName(stored.siteName) || null,
          siteAddress: compactText(stored.siteAddress) || null,
          sitePlz: compactText(stored.sitePlz) || null,
          siteCity: compactText(stored.siteCity) || null,
          siteNote: compactText(stored.siteNote) || null,
          isPrimary: true,
          sortOrder: index,
        };

        // Nur vollständige, dauerhaft gespeicherte Ausführungsadressen anbieten.
        // Ein Objektname ohne Strasse/PLZ/Ort ist zu unsicher für Autocomplete.
        if (
          !normalizedSite.siteAddress ||
          !normalizedSite.sitePlz ||
          !normalizedSite.siteCity
        ) {
          return;
        }

        const key =
          normalizePersistentExecutionAddressKeyV17_68(normalizedSite);
        if (
          !key ||
          key === "||" ||
          usedAddressKeys.has(key) ||
          seen.has(key)
        )
          return;
        seen.add(key);
        suggestions.push(normalizedSite);
      });

    // V17.90L291: Keine fachliche Begrenzung. Die Anzeige wird im
    // Suchfeld scrollbar gehalten, aber alle unbenutzten Orte bleiben erreichbar.
    return suggestions;
  }, [
    customers,
    form.customerId,
    form.siteAddress,
    form.sitePlz,
    form.siteCity,
    formWorkSites,
  ]);

  const applyPersistentExecutionAddressSuggestionV17_68 = (
    site: OrderWorkSite,
  ) => {
    const existingSite =
      formWorkSites.find((entry) => Boolean(entry.isPrimary)) ||
      formWorkSites[0] ||
      null;
    const siteId = existingSite?.id || `local-site-${Date.now().toString(36)}`;
    const nextSite: OrderWorkSite = {
      ...(existingSite || {}),
      id: siteId,
      customerExecutionAddressId: site.customerExecutionAddressId || null,
      siteName: cleanWorkSiteDisplayName(site.siteName) || null,
      siteAddress: compactText(site.siteAddress) || null,
      sitePlz: compactText(site.sitePlz) || null,
      siteCity: compactText(site.siteCity) || null,
      siteNote: compactText(site.siteNote) || null,
      isPrimary: true,
      sortOrder: 0,
    };

    const nextWorkSites = existingSite
      ? formWorkSites.map((entry) =>
          entry.id === existingSite.id
            ? nextSite
            : { ...entry, isPrimary: false },
        )
      : [nextSite];

    setForm((prev) => ({
      ...prev,
      siteAddressDifferent: true,
      siteName: cleanWorkSiteDisplayName(nextSite.siteName) || "",
      siteAddress: nextSite.siteAddress || "",
      sitePlz: nextSite.sitePlz || "",
      siteCity: nextSite.siteCity || "",
      siteNote: nextSite.siteNote || "",
    }));
    setFormWorkSites(nextWorkSites);
    setFormItems((prev) =>
      prev.map((item) => ({
        ...item,
        workSiteId: item.workSiteId || siteId,
      })),
    );
    setActiveWorkSiteId(siteId);
    setExpandedWorkSiteIds((prev) =>
      prev.includes(siteId) ? prev : [siteId, ...prev],
    );
    setSiteAddressEditing(true);
    toast.success("Ausführungsort ausgewählt. Bitte übernehmen.");
  };

  const applyPersistentExecutionAddressSuggestionToWorkSiteV17_90L289 = (
    targetSiteId: string,
    suggestion: OrderWorkSite,
  ) => {
    const replacement = {
      customerExecutionAddressId:
        suggestion.customerExecutionAddressId || null,
      siteName: cleanWorkSiteDisplayName(suggestion.siteName) || null,
      siteAddress: compactText(suggestion.siteAddress) || null,
      sitePlz: compactText(suggestion.sitePlz) || null,
      siteCity: compactText(suggestion.siteCity) || null,
      siteNote: compactText(suggestion.siteNote) || null,
    };

    const target = formWorkSites.find((site) => site.id === targetSiteId);
    setFormWorkSites((current) =>
      current.map((site) =>
        site.id === targetSiteId ? { ...site, ...replacement } : site,
      ),
    );

    if (target?.isPrimary) {
      setForm((current) => ({
        ...current,
        siteAddressDifferent: true,
        siteName: replacement.siteName || "",
        siteAddress: replacement.siteAddress || "",
        sitePlz: replacement.sitePlz || "",
        siteCity: replacement.siteCity || "",
        siteNote: replacement.siteNote || "",
      }));
    }

    setActiveWorkSiteId(targetSiteId);
    setEditingWorkSiteId(targetSiteId);
    setNewItemWorkSiteId(targetSiteId);
    setExpandedWorkSiteIds((current) =>
      current.includes(targetSiteId)
        ? current
        : [targetSiteId, ...current],
    );
    setCustomerExecutionAddressSaveModeV17_90L296("create");
    toast.success("Gespeicherter Ausführungsort übernommen.");
  };

  const resolveCustomerExecutionAddressIdV17_90L295 = (
    site: OrderWorkSite,
  ) => {
    const directId = compactText(site.customerExecutionAddressId);
    if (directId) return directId;
    const customer = customers.find((entry) => entry.id === form.customerId);
    const stored = customer?.executionAddresses || [];
    const exactKey = normalizePersistentExecutionAddressKeyV17_68(site);
    const exact = stored.find(
      (entry) =>
        normalizePersistentExecutionAddressKeyV17_68(entry) === exactKey,
    );
    if (exact?.id) return exact.id;
    const addressMatches = stored.filter((entry) =>
      isSameAddressPartsV17_63(entry, site),
    );
    return addressMatches.length === 1 ? addressMatches[0]?.id || null : null;
  };

  const getSelectedCustomerExecutionAddressV17_90L296 = (site: OrderWorkSite) => {
    const addressId = compactText(site.customerExecutionAddressId);
    if (!addressId) return null;
    const customer = customers.find(
      (entry) => entry.id === compactText(form.customerId),
    );
    return (customer?.executionAddresses || []).find(
      (entry) => entry.id === addressId,
    ) || null;
  };

  const customerExecutionAddressChangedV17_90L296 = (site: OrderWorkSite) => {
    const stored = getSelectedCustomerExecutionAddressV17_90L296(site);
    if (!stored) return false;
    const normalize = (value: unknown) =>
      compactText(String(value ?? ""))
        .toLocaleLowerCase("de-CH")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9äöüß]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return [
      site.siteName,
      site.siteAddress,
      site.sitePlz,
      site.siteCity,
      site.siteNote,
    ].map(normalize).join("|") !== [
      stored.siteName,
      stored.siteAddress,
      stored.sitePlz,
      stored.siteCity,
      stored.siteNote,
    ].map(normalize).join("|");
  };

  const shouldShowCustomerExecutionAddressSaveCheckboxV17_90L298 = (_site?: OrderWorkSite | null) => {
    // V17.90L306: Die alte Checkbox wird durch den eindeutigen Entscheidungsblock
    // ersetzt. So gibt es keine doppelte Logik zwischen Auftrag und Kundenprofil.
    return false;
  };

  const shouldPersistCustomerExecutionAddressChoiceV17_90L305 = (site: OrderWorkSite) => {
    const knownCustomerAddressId =
      compactText(site.customerExecutionAddressId) ||
      resolveCustomerExecutionAddressIdV17_90L295(site);
    if (knownCustomerAddressId) {
      const changed = customerExecutionAddressChangedV17_90L296({
        ...site,
        customerExecutionAddressId: knownCustomerAddressId,
      });
      return changed && customerExecutionAddressSaveModeV17_90L296 !== "local";
    }
    return customerExecutionAddressSaveModeV17_90L296 === "create";
  };

  // V17.90L307: Dokumente dürfen Kundenprofil-Vorlagen nicht überschreiben.
  // Erlaubt sind nur: lokal übernehmen oder als neue Kundenprofil-Vorlage speichern.
  const renderCustomerExecutionAddressSaveChoiceV17_90L296 = (site: OrderWorkSite) => {
    const hasAddressContent = Boolean(
      compactText(site.siteName) ||
        compactText(site.siteAddress) ||
        compactText(site.sitePlz) ||
        compactText(site.siteCity) ||
        compactText(site.siteNote),
    );
    if (!hasAddressContent) return null;
    const knownCustomerAddressId =
      compactText(site.customerExecutionAddressId) ||
      resolveCustomerExecutionAddressIdV17_90L295(site);
    const isChangedStoredAddress = Boolean(
      knownCustomerAddressId &&
        customerExecutionAddressChangedV17_90L296({
          ...site,
          customerExecutionAddressId: knownCustomerAddressId,
        }),
    );
    if (knownCustomerAddressId && !isChangedStoredAddress) return null;

    return (
      <div className="rounded-md border border-amber-300 bg-amber-50/70 p-2.5 text-xs dark:border-amber-800 dark:bg-amber-950/20">
        <div className="mb-2 font-semibold">
          {isChangedStoredAddress
            ? "Gespeicherter Ausführungsort wurde geändert"
            : "Was soll mit dieser Ausführungsadresse passieren?"}
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="customer-execution-address-save-mode-v17-90l307"
              className="mt-0.5"
              checked={customerExecutionAddressSaveModeV17_90L296 === "local"}
              onChange={() => setCustomerExecutionAddressSaveModeV17_90L296("local")}
            />
            <span>
              <span className="font-medium">Nur in diesem Auftrag übernehmen</span>
              <span className="block text-[11px] text-muted-foreground">Kundenprofil bleibt unverändert.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="customer-execution-address-save-mode-v17-90l307"
              className="mt-0.5"
              checked={customerExecutionAddressSaveModeV17_90L296 === "create"}
              onChange={() => setCustomerExecutionAddressSaveModeV17_90L296("create")}
            />
            <span>
              <span className="font-medium">Als neuen Ausführungsort im Kundenprofil speichern</span>
              <span className="block text-[11px] text-muted-foreground">Bestehende Vorlage bleibt erhalten.</span>
            </span>
          </label>
        </div>
      </div>
    );
  };

  const persistOrderExecutionAddressInCustomerV17_90L295 = async (
    site: OrderWorkSite,
  ): Promise<CustomerExecutionAddress> => {
    const customerId = compactText(form.customerId);
    if (!customerId) throw new Error("customer_missing");
    const response = await fetch(
      `/api/customers/${customerId}/execution-addresses/upsert`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addressId: null,
          saveMode: "create",
          siteName: cleanWorkSiteDisplayName(site.siteName) || null,
          siteAddress: compactText(site.siteAddress),
          sitePlz: compactText(site.sitePlz),
          siteCity: compactText(site.siteCity),
          siteNote: compactText(site.siteNote) || null,
        }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || "customer_execution_address_failed");
    }
    const saved = payload as CustomerExecutionAddress;
    setCustomers((current) =>
      current.map((customer) => {
        if (customer.id !== customerId) return customer;
        const previous = customer.executionAddresses || [];
        const next = previous.some((entry) => entry.id === saved.id)
          ? previous.map((entry) => (entry.id === saved.id ? saved : entry))
          : [saved, ...previous];
        return { ...customer, executionAddresses: next };
      }),
    );
    return saved;
  };

  const normalizeExecutionAddressSearchV17_90L291 = (value: unknown) =>
    compactText(String(value ?? ""))
      .toLocaleLowerCase("de-CH")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9äöüß]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const filterExecutionAddressSuggestionsV17_90L291 = (query: unknown) => {
    const tokens = normalizeExecutionAddressSearchV17_90L291(query)
      .split(" ")
      .filter(Boolean);
    if (tokens.length === 0) return previousExecutionAddressSuggestionsV17_68;

    return previousExecutionAddressSuggestionsV17_68.filter((suggestion) => {
      const searchable = normalizeExecutionAddressSearchV17_90L291(
        [
          suggestion.siteName,
          suggestion.siteAddress,
          suggestion.sitePlz,
          suggestion.siteCity,
        ]
          .filter(Boolean)
          .join(" "),
      );
      return tokens.every((token) => searchable.includes(token));
    });
  };

  const renderOrderExecutionAddressAutocompleteV17_90L291 = ({
    inputKey,
    value,
    onChange,
    onSelect,
    label = "Objekt / Bereich",
    labelClassName = "text-xs",
    inputClassName = "",
    placeholder = "z. B. Wohnpark Limmat, Serverraum",
  }: {
    inputKey: string;
    value: string;
    onChange: (value: string) => void;
    onSelect: (suggestion: OrderWorkSite) => void;
    label?: string;
    labelClassName?: string;
    inputClassName?: string;
    placeholder?: string;
  }) => {
    const suggestions = filterExecutionAddressSuggestionsV17_90L291(value);

    return (
      <div className="group relative">
        <Label className={labelClassName}>{label}</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className={`pl-8 ${inputClassName}`.trim()}
            value={value}
            placeholder={placeholder}
            autoComplete="off"
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
        {suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-[140] mt-1 hidden max-h-64 overflow-y-auto rounded-md border border-cyan-200 bg-background p-1.5 shadow-xl group-focus-within:block dark:border-cyan-900/70">
            {suggestions.map((suggestion) => {
              const suggestionKey =
                normalizePersistentExecutionAddressKeyV17_68(suggestion);
              const title = formatWorkSiteTitle(suggestion);
              const address = [
                compactText(suggestion.siteAddress),
                [suggestion.sitePlz, suggestion.siteCity]
                  .map(compactText)
                  .filter(Boolean)
                  .join(" "),
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <div
                  key={`${inputKey}-${suggestionKey}`}
                  className="flex items-stretch gap-1 rounded-md hover:bg-cyan-50 dark:hover:bg-cyan-950/30"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-xs"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onSelect(suggestion)}
                  >
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {title}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {address}
                    </div>
                  </button>
                  {suggestion.customerExecutionAddressId && (
                    <button
                      type="button"
                      className="m-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                      title="Aus Kundenprofil entfernen"
                      aria-label="Ausführungsort aus Kundenprofil entfernen"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.stopPropagation();
                        void deletePersistentExecutionAddressSuggestionV17_72(
                          suggestion,
                        );
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const deletePersistentExecutionAddressSuggestionV17_72 = async (
    site: OrderWorkSite,
  ) => {
    const customerId = String(form.customerId || "").trim();
    const addressId = String(site.customerExecutionAddressId || "").trim();

    if (!customerId || !addressId) {
      toast.error("Ausführungsort konnte nicht eindeutig zugeordnet werden.");
      return;
    }

    const label =
      cleanWorkSiteDisplayName(site.siteName) ||
      [site.siteAddress, site.sitePlz, site.siteCity]
        .map(compactText)
        .filter(Boolean)
        .join(" ") ||
      "Ausführungsort";

    if (!window.confirm(`Ausführungsort "${label}" wirklich entfernen?`)) {
      return;
    }

    try {
      const res = await fetch(
        `/api/customers/${customerId}/execution-addresses/${addressId}`,
        { method: "DELETE" },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}) as any);
        toast.error(
          err?.error || "Ausführungsort konnte nicht entfernt werden.",
        );
        return;
      }

      setCustomers((prev) =>
        prev.map((entry) =>
          entry.id === customerId
            ? {
                ...entry,
                executionAddresses: Array.isArray(entry.executionAddresses)
                  ? entry.executionAddresses.filter(
                      (addr) => addr.id !== addressId,
                    )
                  : [],
              }
            : entry,
        ),
      );

      toast.success("Ausführungsort wurde aus dem Kundenprofil entfernt.");
    } catch {
      toast.error("Netzwerkfehler beim Entfernen des Ausführungsorts.");
    }
  };

  const getWorkSiteShortLabel = (site?: OrderWorkSite | null) => {
    if (!site) return "Ohne Arbeitsort";
    return formatWorkSiteTitle(site);
  };

  const getWorkSiteGroupKey = (site?: OrderWorkSite | null) =>
    site?.id || "__unassigned__";

  const getWorkSiteGroupItems = (site?: OrderWorkSite | null) =>
    site
      ? getWorkSiteItems(site.id)
      : formItems.filter((item) => !item.workSiteId);

  const isWorkSiteGroupExpanded = (site?: OrderWorkSite | null) =>
    !hasMultipleEditWorkSites ||
    expandedWorkSiteIds.includes(getWorkSiteGroupKey(site)) ||
    (!site && formItems.some((item) => !item.workSiteId));

  const toggleWorkSiteGroup = (site?: OrderWorkSite | null) => {
    const key = getWorkSiteGroupKey(site);
    setExpandedWorkSiteIds((prev) =>
      prev.includes(key)
        ? prev.filter((entry) => entry !== key)
        : [key, ...prev],
    );
  };

  const toggleWorkSiteOverview = () => {
    setExpandedWorkSiteIds(
      allEditWorkSiteGroupsExpandedV17_90L290
        ? []
        : currentEditWorkSiteGroupKeysV17_90L290,
    );
    setEditingWorkSiteId(null);
    setMovingItemKey(null);
  };

  const formatWorkSiteItemSummary = (item: FormItem) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const total = getSafeFormItemTotal(item);
    const quantityLabel =
      quantity > 0
        ? `${item.quantity} ${unitShortLabel(item.unit)}`
        : "Menge prüfen";
    const totalLabel = total > 0 ? ` · ${formatCurrency(total, currency)}` : "";
    return `${item.serviceName || "Leistung prüfen"} · ${quantityLabel}${totalLabel}`;
  };

  const formItemDisplayRows = hasMultipleEditWorkSites
    ? [
        ...formItems
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => !item.workSiteId)
          .map(({ item, index }, siteItemIndex) => ({
            item,
            index,
            site: null as OrderWorkSite | null,
            isFirstInSite: siteItemIndex === 0,
            isEmptySitePlaceholder: false,
          })),
        ...currentEditWorkSites.flatMap((site) => {
          const siteRows = formItems
            .map((item, index) => ({ item, index }))
            .filter(({ item }) => item.workSiteId === site.id);

          if (siteRows.length === 0) {
            return [
              {
                item: {
                  ...createEmptyItem(),
                  key: `empty-site-${site.id}`,
                  workSiteId: site.id,
                },
                index: -1,
                site,
                isFirstInSite: true,
                isEmptySitePlaceholder: true,
              },
            ];
          }

          return siteRows.map(({ item, index }, siteItemIndex) => ({
            item,
            index,
            site,
            isFirstInSite: siteItemIndex === 0,
            isEmptySitePlaceholder: false,
          }));
        }),
      ]
    : formItems.map((item, index) => ({
        item,
        index,
        site: null as OrderWorkSite | null,
        isFirstInSite: false,
        isEmptySitePlaceholder: false,
      }));

  const unitShortLabel = (unit: string) => {
    const normalized = (unit || "").toLowerCase();
    if (normalized === "quadratmeter") return "m²";
    if (normalized === "kubikmeter") return "m³";
    if (normalized === "meter") return "m";
    if (normalized === "stunde") return "Std.";
    if (normalized === "tag") return "Tag";
    if (normalized === "pauschal") return "pauschal";
    if (normalized === "stück") return "Stück";
    if (normalized === "kilogramm") return "kg";
    if (normalized === "tonne") return "t";
    if (normalized === "liter") return "l";
    if (normalized.includes("prüfen") || normalized.includes("pruefen"))
      return "prüfen";
    return unit || "–";
  };

  const liveOverviewRows = formItems
    .filter((item) => item.serviceName.trim())
    .map((item, index) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unitPrice || 0);
      const hasQuantity = quantity > 0;
      const hasPrice = unitPrice > 0;
      const sum = getSafeFormItemTotal(item);

      return {
        index: index + 1,
        serviceName: item.serviceName.trim(),
        unit: item.unit,
        unitLabel: unitShortLabel(item.unit),
        quantity,
        unitPrice,
        hasQuantity,
        hasPrice,
        workSiteId: item.workSiteId || null,
        sum,
      };
    });

  const liveOverviewGroups = hasMultipleEditWorkSites
    ? [
        {
          key: "__unassigned__",
          title: "Ohne Arbeitsort",
          address: "Bitte zuordnen",
          rows: liveOverviewRows.filter((row) => !row.workSiteId),
        },
        ...currentEditWorkSites.map((site) => ({
          key: site.id,
          title: formatWorkSiteTitle(site),
          address: formatWorkSiteAddress(site),
          rows: liveOverviewRows.filter((row) => row.workSiteId === site.id),
        })),
      ].filter((group) => group.rows.length > 0)
    : [];

  const parsedFormSpecialNotes = splitSpecialNotes(form.specialNotes);
  const canonicalFormSnapshotV2 = currentEditOrder
    ? getCanonicalIntakeV2(currentEditOrder)
    : null;
  const canonicalFormInfoV2 =
    canonicalFormSnapshotV2 && currentEditOrder
      ? canonicalOrderInfoForOrderV17_90L252(
          currentEditOrder,
          canonicalFormSnapshotV2,
        )
      : canonicalFormSnapshotV2
        ? canonicalOrderInfoV2(canonicalFormSnapshotV2)
        : null;
  const formInfoSummary =
    canonicalFormInfoV2 ||
    buildOrderInfoSummaryV17_65(
      {
        specialNotes: form.specialNotes,
        notes: currentEditOrder?.notes || form.notes,
        audioTranscript: currentEditOrder?.audioTranscript || null,
        intakeSchemaVersion: currentEditOrder?.intakeSchemaVersion || null,
        intakeSnapshot: currentEditOrder?.intakeSnapshot || null,
      },
      parsedFormSpecialNotes,
    );
  // V17.90L205: For sealed Intake V2 orders, the editor renders the canonical
  // roles directly. It must not reclassify safety facts from legacy notes.
  const reclassifiedLegacySafetyHints = canonicalFormInfoV2
    ? []
    : uniqueOrderInfoLinesV17_66(
        parsedFormSpecialNotes.safetyWarnings,
      ).filter((line) => {
        if (/\b(?:hund|dog|chien|cane|perro)\b/i.test(line)) return false;
        return classifySpecialNoteRoleV17_90L93(line) !== "safety";
      });
  const dangerNoteLines = canonicalFormInfoV2
    ? canonicalFormInfoV2.safety
    : uniqueOrderInfoLinesV17_66(
        parsedFormSpecialNotes.safetyWarnings,
      ).filter((line) => {
        if (/\b(?:hund|dog|chien|cane|perro)\b/i.test(line)) return true;
        return classifySpecialNoteRoleV17_90L93(line) === "safety";
      });
  const recognitionReviewSpecialNoteTextsV17_90L262 =
    uniqueOrderInfoLinesV17_66([
      ...currentRecognitionReviewDetailsV17_90L69.flatMap((detail) => [
        compactText(detail.relatedRoleText),
        compactText(detail.sourceText),
      ]),
      ...formItems
        .filter((item) => Boolean(item.recognitionReviewKey))
        .flatMap((item) => [
          compactText(item.sourceDescription),
          compactText(item.aiWarning).replace(/^Text:\s*/i, ""),
        ]),
    ]).filter(Boolean);
  const isRecognitionReviewSpecialNoteV17_90L262 = (
    line?: string | null,
  ) =>
    Boolean(
      compactText(line) &&
        recognitionReviewSpecialNoteTextsV17_90L262.some((reviewText) =>
          orderInfoLinesEquivalentV17_66(compactText(line), reviewText),
        ),
    );
  const primaryInfoLines = formInfoSummary.primary.filter(
    (line) => !isRecognitionReviewSpecialNoteV17_90L262(line),
  );
  const compactPrimaryInfoLines: string[] = canonicalFormInfoV2
    ? [...primaryInfoLines]
    : compactImportantInfoLinesV17_90L73(primaryInfoLines);
  const editablePrimaryJobHints = parsedFormSpecialNotes.jobHints
    .filter(isPrimaryOrderInfoHintV17_65)
    .filter((line) =>
      compactPrimaryInfoLines.some((primaryLine) =>
        orderInfoLinesEquivalentV17_66(primaryLine, line),
      ),
    );
  const preservedParkingJobHints = parsedFormSpecialNotes.jobHints.filter(
    isParkingOrderInfoLineV17_90L101,
  );
  const legacyEditableAdditionalJobHints = uniqueOrderInfoLinesV17_66([
    ...parsedFormSpecialNotes.jobHints,
    ...reclassifiedLegacySafetyHints,
  ])
    .filter((line) => !isParkingOrderInfoLineV17_90L101(line))
    .filter(
      (line) =>
        !compactPrimaryInfoLines.some((primaryLine) =>
          orderInfoLinesEquivalentV17_66(primaryLine, line),
        ),
    );
  // Canonical additional facts already contain parking, ordinary hints and
  // other operational information, while safety remains exclusively red.
  const editableAdditionalJobHints = (
    canonicalFormInfoV2
      ? canonicalFormInfoV2.additional
      : legacyEditableAdditionalJobHints
  ).filter((line) => !isRecognitionReviewSpecialNoteV17_90L262(line));
  const normalSpecialNotesText = formatSpecialNotesForDisplay(
    editableAdditionalJobHints,
  );

  const updateNormalSpecialNotes = (value: string) => {
    const nextJobHints = value
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line && !isSpecialNotesGroupSeparator(line));

    setForm((prev) => {
      const previousNotes = splitSpecialNotes(prev.specialNotes);

      const preservedSafetyWarnings = previousNotes.safetyWarnings.filter(
        (line) =>
          /\b(?:hund|dog|chien|cane|perro)\b/i.test(line) ||
          classifySpecialNoteRoleV17_90L93(line) === "safety",
      );

      return {
        ...prev,
        specialNotes: buildSpecialNotes({
          safetyWarnings: preservedSafetyWarnings,
          jobHints: [
            ...editablePrimaryJobHints,
            ...preservedParkingJobHints,
            ...nextJobHints,
          ],
          preserveStructuredRoles: true,
        }),
      };
    });
  };

  const stripInternalCustomerMessageMetadata = (value?: string | null) =>
    String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return (
          !/^\[\s*(?:titel|title)\s*[:：][^\]]*\]\s*$/i.test(trimmed) &&
          !/^\[\s*(?:priorität|prioritaet|priority)\s*[:：][^\]]*\]\s*$/i.test(
            trimmed,
          )
        );
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const customerMessageText = stripInternalCustomerMessageMetadata(
    currentEditOrder?.notes ||
      currentEditOrder?.audioTranscript ||
      form.notes ||
      "",
  );

  const normalizeCustomerMessageForCompare = (value?: string | null) =>
    stripInternalCustomerMessageMetadata(value)
      .replace(/^(whatsapp|telegram):\s*/i, "")
      .replace(/\[\s*(?:transkription|transcription|transkript)\s*\]/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const customerMessageTranscriptDuplicate = Boolean(
    currentEditOrder?.audioTranscript &&
    customerMessageText &&
    (() => {
      const msg = normalizeCustomerMessageForCompare(customerMessageText);
      const transcript = normalizeCustomerMessageForCompare(
        currentEditOrder.audioTranscript,
      );
      return Boolean(
        msg &&
        transcript &&
        (msg === transcript ||
          msg.includes(transcript) ||
          transcript.includes(msg)),
      );
    })(),
  );

  const visibleCustomerMessageText = customerMessageTranscriptDuplicate
    ? ""
    : customerMessageText;

  const shouldCollapseCustomerMessages = currentEditOrder
    ? shouldCollapseCustomerMessagesForOrder(currentEditOrder)
    : false;
  const customerMessagesVisible =
    !shouldCollapseCustomerMessages || customerMessagesExpanded;

  // Build description from items
  const buildDescription = () => {
    return (
      formItems
        .filter((i) => i.serviceName)
        .map((i) => i.serviceName)
        .join(", ") || form.description
    );
  };

  // Save customer (update or create — no merge logic, merge goes via Sheet)
  const saveCustomer = async () => {
    if (!newCust.name.trim()) {
      toast.error("Name erforderlich");
      return;
    }
    setSavingCust(true);
    try {
      if (editingCustomer && form.customerId) {
        // Phase 2f: compute fieldsToClear = fields where DB had a value but user
        // intentionally emptied them. Only these are allowed to be cleared by the
        // server's opt-in clear-protection guard.
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
        // Update existing customer
        const previousCustomerId = form.customerId;
        const res = await fetch(`/api/customers/${previousCustomerId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...newCust, fieldsToClear }),
        });
        if (res.ok) {
          const updated = await res.json();
          setCustomers((prev) => {
            const withoutReplacedDraft = prev.filter(
              (c) => c.id !== previousCustomerId || c.id === updated.id,
            );
            const hasUpdated = withoutReplacedDraft.some((c) => c.id === updated.id);
            if (hasUpdated) {
              return withoutReplacedDraft.map((c) =>
                c.id === updated.id ? { ...c, ...updated } : c,
              );
            }
            return [...withoutReplacedDraft, updated];
          });
          // Also update nested customer in orders so list/cards refresh immediately.
          // V17.87f: when a draft customer is completed with the same main data
          // as an existing customer, the API returns the existing customer and
          // moves the order server-side. Reflect that local customerId switch too.
          setOrders((prev) =>
            prev.map((o) =>
              o.customerId === previousCustomerId || o.customerId === updated.id || o.id === editId
                ? { ...o, customerId: updated.id, customer: { ...o.customer, ...updated } }
                : o,
            ),
          );
          setForm((f) => ({ ...f, customerId: updated.id }));
          // Nur erledigte Kunden-Prüfungen entfernen. Währungs-, Leistungs-
          // und Ausführungsadress-Blocker müssen unverändert erhalten bleiben.
          if (
            editId &&
            updated.name?.trim() &&
            updated.address?.trim() &&
            updated.plz?.trim() &&
            updated.city?.trim()
          ) {
            const curOrder = orders.find((o: Order) => o.id === editId);
            if (curOrder) {
              const remainingReviewReasons = (curOrder.reviewReasons || []).filter(
                (reason) => !isResolvedCustomerReviewReasonV17_90L36(reason),
              );
              try {
                const reviewRes = await fetch(`/api/orders/${editId}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    needsReview: remainingReviewReasons.length > 0,
                    reviewReasons: remainingReviewReasons,
                  }),
                });
                if (reviewRes.ok) {
                  setOrders((prev) =>
                    prev.map((o) =>
                      o.id === editId
                        ? {
                            ...o,
                            needsReview: remainingReviewReasons.length > 0,
                            reviewReasons: remainingReviewReasons,
                          }
                        : o,
                    ),
                  );
                }
              } catch {}
            }
          }
          if (pendingBillingAddressRoleAutoSaveV17_64 && editId) {
            const clearedWorkSites =
              blankWorkSitesForClearedExecutionAddressV17_64(formWorkSites);
            const savedOrder = await persistAddressReviewPatchV17_64(
              {
                customerId: updated.id,
                siteAddressDifferent: false,
                siteName: "",
                siteAddress: "",
                sitePlz: "",
                siteCity: "",
                siteNote: "",
              },
              clearedWorkSites,
              { resolveAddressReview: true },
            );
            setPendingBillingAddressRoleAutoSaveV17_64(false);
            toast.success(
              savedOrder
                ? `Kunde "${updated.name}" aktualisiert und Auftrag gespeichert.`
                : `Kunde "${updated.name}" aktualisiert.`,
            );
          } else {
            toast.success(`Kunde "${updated.name}" aktualisiert!`);
          }
        } else {
          const err = await res.json().catch(() => ({}) as any);
          if (err?.reason === "would_clear_existing_value")
            toast.error(err?.error || "Feld kann nicht geleert werden.");
          else toast.error("Fehler beim Aktualisieren");
          return;
        }
      } else {
        // Create new customer
        const res = await fetch("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newCust),
        });
        if (res.ok) {
          const created = await res.json();
          setCustomers((prev) => [...prev, created]);
          setForm((f) => ({ ...f, customerId: created.id }));
          if (pendingBillingAddressRoleAutoSaveV17_64 && editId) {
            const clearedWorkSites =
              blankWorkSitesForClearedExecutionAddressV17_64(formWorkSites);
            const savedOrder = await persistAddressReviewPatchV17_64(
              {
                customerId: created.id,
                siteAddressDifferent: false,
                siteName: "",
                siteAddress: "",
                sitePlz: "",
                siteCity: "",
                siteNote: "",
              },
              clearedWorkSites,
              { resolveAddressReview: true },
            );
            setPendingBillingAddressRoleAutoSaveV17_64(false);
            toast.success(
              savedOrder
                ? "Neuer Kunde erstellt und Auftrag gespeichert."
                : "Neuer Kunde erstellt – eigene ID wurde vergeben",
            );
          } else {
            toast.success("Neuer Kunde erstellt – eigene ID wurde vergeben");
          }
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

  // Core save function — returns saved order or null
  const saveOrder = async (
    payloadOverrides?: Partial<typeof form>,
    itemsOverride?: FormItem[],
    resolvedCatalogServiceNamesOverride?: Set<string>,
    reviewResolutionOptionsV17_90L241?: {
      discardedServiceNames?: Set<string>;
      acknowledgeResidualCurrency?: boolean;
    },
    workSitesOverride?: OrderWorkSite[],
    forceClearExecutionAddressV17_90L302 = false,
  ): Promise<Order | null> => {
    if (!form.customerId) {
      toast.error("Bitte Kunde auswählen");
      return null;
    }
    const sourceFormItems = itemsOverride ?? formItems;
    const sourceFormWorkSites = workSitesOverride ?? formWorkSites;
    let validItems = mergeEquivalentFormItems(
      sourceFormItems.filter((i) => i.serviceName.trim()),
    );
    if (validItems.length === 0) {
      toast.error("Mindestens eine Leistung auswählen");
      return null;
    }

    const assignedWorkSiteIds = new Set(
      validItems
        .map((item) => item.workSiteId)
        .filter((siteId): siteId is string => Boolean(siteId)),
    );

    // V17.90L36c: Die kompakte Ausführungsadress-Maske schreibt in `form`.
    // `formWorkSites` kann dabei noch den alten, unvollständigen Stand tragen.
    // Vor jedem Speichern wird deshalb der primäre Arbeitsort ausdrücklich mit
    // den aktuell sichtbaren Editorfeldern synchronisiert. So werden Strasse,
    // PLZ und Ort weder verworfen noch durch alte WorkSite-Werte überschrieben.
    const currentPrimaryWorkSiteForEditor =
      sourceFormWorkSites.find((site) => Boolean(site.isPrimary)) ||
      sourceFormWorkSites[0] ||
      null;
    const hasCurrentExecutionAddressEditorContent = Boolean(
      form.siteAddressDifferent &&
        sourceFormWorkSites.length <= 1 &&
        [
          form.siteName,
          form.siteAddress,
          form.sitePlz,
          form.siteCity,
          form.siteNote,
        ].some((value) => String(value || "").trim()),
    );
    const synchronizedFormWorkSites = hasCurrentExecutionAddressEditorContent
      ? (() => {
          const primaryId =
            currentPrimaryWorkSiteForEditor?.id ||
            `local-site-${editId || Date.now().toString(36)}`;
          const synchronizedPrimary: OrderWorkSite = {
            ...(currentPrimaryWorkSiteForEditor || {}),
            id: primaryId,
            siteName: cleanWorkSiteDisplayName(form.siteName) || null,
            siteAddress: form.siteAddress?.trim() || null,
            sitePlz: form.sitePlz?.trim() || null,
            siteCity: form.siteCity?.trim() || null,
            siteNote: form.siteNote?.trim() || null,
            isPrimary: true,
            sortOrder: 0,
          };

          if (!currentPrimaryWorkSiteForEditor) {
            return [synchronizedPrimary];
          }

          return sourceFormWorkSites.map((site, index) =>
            site.id === currentPrimaryWorkSiteForEditor.id
              ? synchronizedPrimary
              : {
                  ...site,
                  sortOrder: Math.max(1, Number(site.sortOrder ?? index + 1)),
                },
          );
        })()
      : sourceFormWorkSites;

    const cleanWorkSites = synchronizedFormWorkSites.filter(
      (site) => hasWorkSiteContent(site) || assignedWorkSiteIds.has(site.id),
    );

    // V17.90L292: Der sichtbare Arbeitsort muss vor dem Speichern verbindlich
    // mit den gespeicherten Leistungszeilen verknüpft sein. Bei genau einem
    // Arbeitsort werden noch unzugeordnete Leistungen diesem Ort zugewiesen.
    // Bei mehreren Arbeitsorten bleibt die bewusste Zuordnung unverändert.
    const canonicalPrimaryWorkSiteIdV17_90L292 =
      cleanWorkSites.find((site) => Boolean(site.isPrimary))?.id ||
      cleanWorkSites[0]?.id ||
      null;
    if (cleanWorkSites.length === 1 && canonicalPrimaryWorkSiteIdV17_90L292) {
      const currentWorkSiteIdsV17_90L292 = new Set(
        cleanWorkSites.map((site) => site.id),
      );
      validItems = validItems.map((item) =>
        item.workSiteId && currentWorkSiteIdsV17_90L292.has(item.workSiteId)
          ? item
          : { ...item, workSiteId: canonicalPrimaryWorkSiteIdV17_90L292 },
      );
    }

    const workSiteWithoutServiceV17_90L292 = cleanWorkSites.find(
      (site) =>
        !validItems.some(
          (item) =>
            item.workSiteId === site.id &&
            Boolean(compactText(item.serviceName)),
        ),
    );
    if (workSiteWithoutServiceV17_90L292) {
      toast.error(
        "Bitte für jeden Arbeitsort mindestens eine Leistung ausfüllen.",
      );
      return null;
    }

    const primaryWorkSiteForPayload =
      cleanWorkSites.find((site) => Boolean(site.isPrimary)) ||
      cleanWorkSites[0] ||
      null;
    const siteFieldsForPayload = primaryWorkSiteForPayload
      ? {
          siteAddressDifferent: true,
          siteName:
            cleanWorkSiteDisplayName(primaryWorkSiteForPayload.siteName) || "",
          siteAddress: primaryWorkSiteForPayload.siteAddress?.trim() || "",
          sitePlz: primaryWorkSiteForPayload.sitePlz?.trim() || "",
          siteCity: primaryWorkSiteForPayload.siteCity?.trim() || "",
          siteNote: primaryWorkSiteForPayload.siteNote?.trim() || "",
        }
      : {};
    const saveExecutionAddressInCustomerProfileForPayloadV17_90L306 =
      primaryWorkSiteForPayload
        ? shouldPersistCustomerExecutionAddressChoiceV17_90L305(primaryWorkSiteForPayload)
        : false;

    if (
      cleanWorkSites.length > 1 &&
      validItems.some((item) => !item.workSiteId)
    ) {
      toast.error("Bitte jeder Leistung einen Arbeitsort zuordnen.");
      return null;
    }
    const desc = form.description?.trim() || buildDescription();
    if (!desc) {
      toast.error("Beschreibung erforderlich");
      return null;
    }

    const url = editId ? `/api/orders/${editId}` : "/api/orders";
    const method = editId ? "PUT" : "POST";
    const validServiceNames = new Set(
      validItems
        .filter(
          (item) =>
            Number(item.quantity || 0) > 0 &&
            Number(item.unitPrice || 0) > 0 &&
            !isBlockedFormItemForTotal(item),
        )
        .map((item) => normalizeForMatch(item.serviceName)),
    );

    const confirmedCatalogReviewServiceNames = new Set(
      validItems
        .filter((item) => Boolean(item.catalogReviewConfirmed))
        .map((item) => normalizeForMatch(item.serviceName)),
    );

    resolvedCatalogServiceNamesOverride?.forEach((serviceName) => {
      if (serviceName) confirmedCatalogReviewServiceNames.add(serviceName);
    });

    const allItemsComplete = validItems.every(
      (item) =>
        item.serviceName.trim().length > 0 &&
        !isInternalReviewServiceName(item.serviceName) &&
        Number(item.quantity || 0) > 0 &&
        Number(item.unitPrice || 0) > 0 &&
        !isBlockedFormItemForTotal(item),
    );

    // V17.90i: Ein automatisch vollständig wirkender Intake-Posten ist noch
    // keine manuelle Bestätigung. Sonst werden vage KI-Zeilen wie
    // "hinten sauber machen" mit erfundener Stunden-Einheit beim Speichern
    // fälschlich als berechenbar fixiert. Explizit bestätigte Einheiten,
    // Währungen oder Katalogentscheidungen bleiben weiterhin vertrauenswürdig.
    const hasExplicitManualItemConfirmation = validItems.some(
      (item) =>
        Boolean(item.manualUnitConfirmed) ||
        Boolean(item.manualCurrencyConfirmed) ||
        Boolean(item.manualReviewConfirmed) ||
        Boolean(item.catalogReviewConfirmed),
    );

    const allServicesInCatalog = validItems.every((item) =>
      isServiceInCatalog(item.serviceName),
    );
    const hasPendingManualReviewDecisionV17_90L247 = validItems.some(
      (item) =>
        Boolean(item.pendingManualReviewDecision) &&
        !Boolean(item.manualReviewConfirmed),
    );

    const isAddressRoleReviewReasonV17_61 = (reason: string) =>
      reason === "address_role_uncertain" ||
      reason === "customer_address_quarantined_ambiguous_role_v17_61" ||
      reason === "execution_address_incomplete" ||
      reason === "intake_risk:execution_address_incomplete" ||
      reason.startsWith("intake_address:");

    // V17.20: ReviewReasons pro Leistung bereinigen, nicht erst wenn alle
    // Positionen erledigt sind. Sonst bleiben Außenkarte/Conversion global auf
    // 0/rot, obwohl einzelne Leistungen bereits manuell bestätigt wurden.
    const manuallyConfirmedServiceNames = new Set(
      validItems
        .filter((item) => isManuallyConfirmedCurrencyItem(item))
        .map((item) =>
          normalizeForMatch(canonicalServiceNameForOrderItem(item.serviceName)),
        )
        .filter(Boolean),
    );

    const manuallyUnitConfirmedServiceNames = new Set(
      validItems
        .filter((item) => Boolean(item.manualUnitConfirmed))
        .map((item) =>
          normalizeForMatch(canonicalServiceNameForOrderItem(item.serviceName)),
        )
        .filter(Boolean),
    );

    // V17.90L234: A price contradiction may only disappear after an explicit
    // item-level confirmation/correction. Complete untouched rows are not
    // treated as confirmed merely because quantity, unit and price are filled.
    const manuallyReviewConfirmedServiceNamesV17_90L241 = new Set(
      validItems
        .filter((item) => Boolean(item.manualReviewConfirmed))
        .flatMap((item) => [
          normalizeForMatch(canonicalServiceNameForOrderItem(item.serviceName)),
          normalizeForMatch(
            canonicalServiceNameForOrderItem(
              item.pendingReviewSourceServiceName || "",
            ),
          ),
        ])
        .filter(Boolean),
    );

    const discardedServiceNamesV17_90L241 = new Set(
      Array.from(
        reviewResolutionOptionsV17_90L241?.discardedServiceNames || [],
      )
        .map((serviceName) =>
          normalizeForMatch(canonicalServiceNameForOrderItem(serviceName)),
        )
        .filter(Boolean),
    );

    const manuallyPriceConfirmedServiceNamesV17_90L234 = new Set(
      validItems
        .filter(
          (item) =>
            Boolean(item.manualCurrencyConfirmed) ||
            Boolean(item.catalogReviewConfirmed),
        )
        .map((item) =>
          normalizeForMatch(canonicalServiceNameForOrderItem(item.serviceName)),
        )
        .filter(Boolean),
    );

    const currentCurrencyMismatchDetails = getCurrencyMismatchReviewDetails(
      currentEditReviewReasons,
    );
    const allItemCurrencyReviewsManuallyResolved =
      currentCurrencyMismatchDetails.length > 0 &&
      currentCurrencyMismatchDetails.every((detail) =>
        manuallyConfirmedServiceNames.has(
          normalizeForMatch(
            canonicalServiceNameForOrderItem(detail.serviceName),
          ),
        ),
      );
    const hasUnresolvedEditableCurrencyItem = validItems.some((item) =>
      isFormItemBlockedByCurrencyReview(item),
    );
    const hasExplicitCurrencyItemConfirmation = validItems.some(
      (item) =>
        Boolean(item.manualCurrencyConfirmed) &&
        isCompleteResolvedFormItem(item),
    );
    const currencyReviewManuallyResolved = Boolean(
      hasCurrentEditCurrencyReview &&
        (allItemCurrencyReviewsManuallyResolved ||
          hasExplicitCurrencyItemConfirmation ||
          (!hasUnresolvedEditableCurrencyItem &&
            (manualResidualCurrencyAcknowledged ||
              Boolean(
                reviewResolutionOptionsV17_90L241
                  ?.acknowledgeResidualCurrency,
              )))),
    );

    const isReviewReasonResolvedByManualUnit = (reason: string) => {
      const key = String(reason || "");
      if (
        !key.startsWith("unit_missing_in_text:") &&
        !key.startsWith("canonical_mutation_blocked:")
      ) {
        return false;
      }
      const serviceName = normalizeForMatch(
        canonicalServiceNameForOrderItem(key.split(":").slice(1).join(":")),
      );
      return Boolean(
        serviceName &&
          Array.from(manuallyUnitConfirmedServiceNames).some((candidate) =>
            reviewServiceNamesMatchV17_90L241(serviceName, candidate),
          ),
      );
    };

    const reviewReasonServiceKeyV17_90L241 = (reason: string) => {
      const key = String(reason || "");
      const supportedPrefixes = [
        "canonical_mutation_blocked:",
        "unit_missing_in_text:",
        "unit_mismatch:",
        "price_unclear:",
        "price_override:",
        "price_contradiction:",
        "item_currency_mismatch:",
        "currency_conflict_item:",
        "service_action_unclear:",
      ];
      const prefix = supportedPrefixes.find((candidate) =>
        key.startsWith(candidate),
      );
      if (!prefix) return "";

      // V17.90L243: Einige Prüfgründe enthalten nach dem Leistungsnamen noch
      // technische Werte (z. B. Katalog-/Textpreis oder Währungen). Für die
      // positionsgenaue Auflösung darf nur der Leistungsname verglichen werden.
      const remainder = key.slice(prefix.length);
      const serviceName = [
        "unit_mismatch:",
        "price_override:",
        "item_currency_mismatch:",
        "currency_conflict_item:",
      ].includes(prefix)
        ? remainder.split(":")[0] || ""
        : remainder;

      return normalizeForMatch(
        canonicalServiceNameForOrderItem(serviceName),
      );
    };

    const isReviewReasonResolvedByManualReviewV17_90L241 = (
      reason: string,
    ) => {
      const serviceKey = reviewReasonServiceKeyV17_90L241(reason);
      return Boolean(
        serviceKey &&
          Array.from(manuallyReviewConfirmedServiceNamesV17_90L241).some(
            (candidate) =>
              reviewServiceNamesMatchV17_90L241(serviceKey, candidate),
          ),
      );
    };

    const isReviewReasonDiscardedWithServiceV17_90L241 = (
      reason: string,
    ) => {
      const serviceKey = reviewReasonServiceKeyV17_90L241(reason);
      return Boolean(
        serviceKey &&
          Array.from(discardedServiceNamesV17_90L241).some((candidate) =>
            reviewServiceNamesMatchV17_90L241(serviceKey, candidate),
          ),
      );
    };

    const isReviewReasonResolvedByConfirmedItem = (reason: string) => {
      const key = String(reason || "");
      const parts = key.split(":");
      const reasonService = key.startsWith("price_contradiction:")
        ? parts.slice(1).join(":")
        : parts[1] || "";
      const serviceName = normalizeForMatch(
        canonicalServiceNameForOrderItem(reasonService),
      );
      if (!serviceName) return false;

      if (key.startsWith("price_contradiction:")) {
        return manuallyPriceConfirmedServiceNamesV17_90L234.has(serviceName);
      }

      if (!manuallyConfirmedServiceNames.has(serviceName)) return false;
      return (
        key.startsWith("price_unclear:") ||
        key.startsWith("item_currency_mismatch:") ||
        key.startsWith("currency_conflict_item:") ||
        key.startsWith("price_override:")
      );
    };

    let cleanedReviewReasons = currentEditReviewReasons.filter((reason) => {
          // V17.90L247: If a still-pending generic review row was renamed in
          // the editor, replace its old service key with a current-name key
          // below. Otherwise the stale "Leistung prüfen" reason would survive
          // a later explicit confirmation after reload.
          const pendingReasonServiceKeyV17_90L247 =
            reviewReasonServiceKeyV17_90L241(reason);
          if (pendingReasonServiceKeyV17_90L247) {
            const shouldRekeyPendingReasonV17_90L247 = validItems.some(
              (item) => {
                if (
                  !item.pendingManualReviewDecision ||
                  item.manualReviewConfirmed
                ) {
                  return false;
                }
                const sourceKey = normalizeForMatch(
                  canonicalServiceNameForOrderItem(
                    item.pendingReviewSourceServiceName || "",
                  ),
                );
                const currentKey = normalizeForMatch(
                  canonicalServiceNameForOrderItem(item.serviceName),
                );
                return Boolean(
                  sourceKey &&
                    currentKey &&
                    sourceKey !== currentKey &&
                    reviewServiceNamesMatchV17_90L241(
                      pendingReasonServiceKeyV17_90L247,
                      sourceKey,
                    ),
                );
              },
            );
            if (shouldRekeyPendingReasonV17_90L247) return false;
          }

          // V17.90L109: Role-checker findings are trace diagnostics only.
          if (String(reason || "").startsWith(
            "intake_risk:special_note_role_review:",
          )) {
            return false;
          }

          if (isRecognitionReviewReasonV17_90L69(reason)) {
            const decisionKey = recognitionReviewReasonKeyV17_90L70(reason);
            if (
              decisionKey &&
              discardedRecognitionReviewKeys.includes(decisionKey)
            ) {
              return false;
            }

            const detail = parseRecognitionReviewReasonV17_90L69(reason);
            if (detail) {
              const detailKey = recognitionReviewDetailKeyV17_90L70(detail);
              if (detail.kind && detail.kind !== "missing_work") return true;
              return !validItems.some(
                (item) =>
                  item.recognitionReviewKey === detailKey ||
                  recognitionReviewDetailMatchesItemV17_90L69(detail, item),
              );
            }

            if (
              reason === RECOGNITION_REVIEW_GENERIC_REASON_V17_90L69 &&
              allCurrentRecognitionReviewDetailsV17_90L69.length > 0
            ) {
              return allCurrentRecognitionReviewDetailsV17_90L69.some(
                (candidate) => {
                  const candidateKey =
                    recognitionReviewDetailKeyV17_90L70(candidate);
                  return (
                    !discardedRecognitionReviewKeys.includes(candidateKey) &&
                    !validItems.some((item) =>
                      recognitionReviewDetailMatchesItemV17_90L69(
                        candidate,
                        item,
                      ),
                    )
                  );
                },
              );
            }

            return true;
          }
          // V17.90L243: Übernehmen/Verwerfen löst immer nur die konkret
          // gewählte rote Position auf – unabhängig davon, ob der alte Grund als
          // Einheit, Menge, Preis, Währung oder Katalogabweichung gespeichert war.
          if (
            isReviewReasonResolvedByManualReviewV17_90L241(reason) ||
            isReviewReasonDiscardedWithServiceV17_90L241(reason)
          ) {
            return false;
          }

          if (reason.startsWith("unit_mismatch:")) {
            const [, reasonService] = reason.split(":");
            const reasonName = normalizeForMatch(reasonService);
            return !validServiceNames.has(reasonName);
          }

          if (reason.startsWith("price_override:")) {
            const [, reasonService] = reason.split(":");
            const reasonName = normalizeForMatch(reasonService);
            return !confirmedCatalogReviewServiceNames.has(reasonName);
          }

          if (
            isReviewReasonResolvedByConfirmedItem(reason) ||
            isReviewReasonResolvedByManualUnit(reason)
          ) {
            return false;
          }

          if (
            currencyReviewManuallyResolved &&
            (reason.startsWith("currency_") ||
              reason.startsWith("item_currency_mismatch:") ||
              reason.startsWith("currency_conflict_item:"))
          ) {
            return false;
          }

          if (
            !editId &&
            allItemsComplete &&
            (reason.startsWith("price_unclear:") ||
              reason === "unit_price_review" ||
              reason === "quantity_review" ||
              reason.startsWith("quantity_range_review:") ||
              reason === "manual_flat_service_from_text" ||
              reason === "stunden_arbeitsposition_pruefen")
          ) {
            return false;
          }

          if (
            allServicesInCatalog &&
            reason === "unbekannte_leistung_pruefen"
          ) {
            return false;
          }

          // L94: Eine offene Adressrollen-Prüfung darf durch normales Speichern
          // niemals still verschwinden. Sie wird nur über Übernehmen,
          // Verwerfen oder das ausdrückliche Speichern im Adresseditor gelöst.
          if (isAddressRoleReviewReasonV17_61(reason)) {
            return true;
          }

          return true;
        });

    // V17.90L247: A normal save must preserve every still-pending red row,
    // even when the user has already replaced the generic service name and
    // filled all fields. Add one current-name review key so reload keeps the
    // row red until Übernehmen/Verwerfen is pressed.
    validItems
      .filter(
        (item) =>
          Boolean(item.pendingManualReviewDecision) &&
          !Boolean(item.manualReviewConfirmed),
      )
      .forEach((item) => {
        const serviceName = canonicalServiceNameForOrderItem(item.serviceName);
        if (!serviceName) return;
        const serviceKey = normalizeForMatch(serviceName);
        const alreadyCovered = cleanedReviewReasons.some((reason) => {
          const reasonKey = reviewReasonServiceKeyV17_90L241(reason);
          return Boolean(
            reasonKey &&
              serviceKey &&
              reviewServiceNamesMatchV17_90L241(reasonKey, serviceKey),
          );
        });
        if (!alreadyCovered) {
          cleanedReviewReasons.push(
            `canonical_mutation_blocked:${serviceName}`,
          );
        }
      });
    cleanedReviewReasons = Array.from(new Set(cleanedReviewReasons));

    const payload = {
      ...form,
      ...siteFieldsForPayload,
      ...payloadOverrides,
      description: desc,
      vatRate: orderVatRate,
      currency,
      // V17.14: Beim manuellen Bereinigen einer Mischwährung müssen die
      // sichtbaren Editorwerte als bestätigt gespeichert werden. Sonst ziehen
      // API-Sicherheitsnetze beim erneuten Öffnen wieder Preise/Währung aus dem
      // ursprünglichen Kundentext und überschreiben die manuelle Korrektur.
      manualReviewResolved:
        !hasPendingManualReviewDecisionV17_90L247 &&
        (formHasResolvedCurrencyReview ||
          hasExplicitManualItemConfirmation ||
          (!editId && allItemsComplete && !hasCurrentEditCurrencyReview)),
      manualItemValuesConfirmed:
        !hasPendingManualReviewDecisionV17_90L247 &&
        (formHasResolvedCurrencyReview ||
          hasExplicitManualItemConfirmation ||
          (!editId && allItemsComplete && !hasCurrentEditCurrencyReview)),
      manualCurrencyReviewResolved: currencyReviewManuallyResolved,
      manualResidualCurrencyAcknowledged,
      reviewReasons: cleanedReviewReasons,
      needsReview: cleanedReviewReasons.length > 0,
      clearExecutionAddress: Boolean(
        editId && (executionAddressClearRequested || forceClearExecutionAddressV17_90L302),
      ),
      saveExecutionAddressInCustomerProfile: saveExecutionAddressInCustomerProfileForPayloadV17_90L306,
      upsertCustomerExecutionAddress: saveExecutionAddressInCustomerProfileForPayloadV17_90L306,
      skipCustomerExecutionAddressUpsert: !saveExecutionAddressInCustomerProfileForPayloadV17_90L306,
      workSites:
        editId && (executionAddressClearRequested || forceClearExecutionAddressV17_90L302)
          ? []
          : cleanWorkSites.length > 0
            ? (() => {
                const canonicalPrimarySiteIdV17_90L285 =
                  cleanWorkSites.find((site) => Boolean(site.isPrimary))?.id ||
                  cleanWorkSites[0]?.id ||
                  null;
                return cleanWorkSites.map((site, index) => ({
                  id: site.id,
                  siteName: cleanWorkSiteDisplayName(site.siteName) || null,
                  siteAddress: site.siteAddress?.trim() || null,
                  sitePlz: site.sitePlz?.trim() || null,
                  siteCity: site.siteCity?.trim() || null,
                  siteNote: site.siteNote?.trim() || null,
                  isPrimary: site.id === canonicalPrimarySiteIdV17_90L285,
                  sortOrder: index,
                  sourceOrderId: (site as any).sourceOrderId || null,
                }));
              })()
            : undefined,
      items: validItems.map((item) => {
        const itemCurrencyConfirmed = isManuallyConfirmedCurrencyItem(item);
        const itemIsStillBlockedByCurrency =
          isFormItemBlockedByCurrencyReview(item);
        const resolvedCurrencyItem =
          !itemIsStillBlockedByCurrency &&
          (formHasResolvedCurrencyReview || itemCurrencyConfirmed);
        const itemServiceKeyV17_90L245 = normalizeForMatch(
          canonicalServiceNameForOrderItem(item.serviceName),
        );
        const hasPendingExplicitItemDecisionV17_90L245 = Boolean(
          (item.pendingManualReviewDecision &&
            !item.manualReviewConfirmed) ||
          (editId &&
            !item.manualReviewConfirmed &&
            currentEditReviewReasons.some((reason) => {
              const key = String(reason || "");
              if (
                !key.startsWith("price_unclear:") &&
                !key.startsWith("price_contradiction:") &&
                !key.startsWith("unit_missing_in_text:") &&
                !key.startsWith("canonical_mutation_blocked:") &&
                !key.startsWith("item_currency_mismatch:") &&
                !key.startsWith("currency_conflict_item:")
              ) {
                return false;
              }
              const reasonServiceKey = reviewReasonServiceKeyV17_90L241(key);
              return Boolean(
                reasonServiceKey &&
                  itemServiceKeyV17_90L245 &&
                  reviewServiceNamesMatchV17_90L241(
                    reasonServiceKey,
                    itemServiceKeyV17_90L245,
                  ),
              );
            })),
        );

        return {
          serviceName: canonicalServiceNameForOrderItem(item.serviceName),
          description:
            hasCurrentEditCurrencyReview && itemCurrencyConfirmed
              ? `${MANUAL_CURRENCY_CONFIRMED_PREFIX} ${item.serviceName}`.trim()
              : resolvedCurrencyItem
                ? buildItemDescription({ ...item, aiWarning: "" })
                : buildItemDescription(item),
          quantity: Number(item.quantity || 0),
          unit: item.unit,
          unitPrice: itemIsStillBlockedByCurrency
            ? 0
            : Number(item.unitPrice || 0),
          totalPrice: hasPendingExplicitItemDecisionV17_90L245
            ? 0
            : getSafeFormItemTotal(item),
          workSiteId: item.workSiteId || null,
        };
      }),
    };
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      // V17.90L275: The normal order PUT now preserves the exact canonical
      // `specialNotes`. Do not run a second save or a second interpretation.
      const saved = await res.json();
      setExecutionAddressClearRequested(false);
      return saved;
    }
    toast.error("Fehler beim Speichern");
    return null;
  };

  const confirmCurrentItemReviewV17_90L241 = async (index: number) => {
    const item = formItems[index];
    if (!item || !isCompleteResolvedFormItem(item)) {
      toast.error("Bitte Leistung, Einheit, Menge und Preis vollständig ausfüllen.");
      return;
    }

    const confirmsCurrencyOrPriceContradictionV17_90L243 = Boolean(
      hasFormItemCurrencyMismatch(item) ||
        isBlockingCurrencyReviewText(item.aiWarning) ||
        findPriceContradictionReviewForServiceV17_90L234(
          currentEditReviewReasons,
          item.serviceName,
        ),
    );

    const nextItems = formItems.map((entry, entryIndex) =>
      entryIndex === index
        ? {
            ...entry,
            aiWarning: "",
            manualReviewConfirmed: true,
            pendingManualReviewDecision: false,
            // Keep the original review service key for this save call so old
            // generic reasons such as service_action_unclear:Leistung prüfen
            // are removed together with the newly selected service name.
            pendingReviewSourceServiceName:
              entry.pendingReviewSourceServiceName || entry.serviceName,
            manualCurrencyConfirmed: Boolean(
              entry.manualCurrencyConfirmed ||
                confirmsCurrencyOrPriceContradictionV17_90L243,
            ),
            manualUnitConfirmed: Boolean(
              entry.manualUnitConfirmed ||
                findUnitMissingInTextReviewForService(
                  currentEditReviewReasons,
                  entry.serviceName,
                ),
            ),
          }
        : entry,
    );

    setSaving(true);
    setFormItems(nextItems);
    try {
      const saved = await saveOrder(undefined, nextItems);
      if (!saved) return;
      setOrders((previous) =>
        previous.map((order) =>
          order.id === saved.id ? { ...order, ...saved } : order,
        ),
      );
      await load();
      toast.success("Aktuelle Angaben übernommen. Prüfung ist aufgelöst.");
    } catch {
      toast.error("Prüfung konnte nicht aufgelöst werden.");
    } finally {
      setSaving(false);
    }
  };

  const discardCurrentItemReviewV17_90L241 = async (index: number) => {
    const item = formItems[index];
    if (!item) return;
    if (formItems.filter((entry) => entry.serviceName.trim()).length <= 1) {
      toast.error("Mindestens eine Leistung muss im Auftrag bleiben.");
      return;
    }

    const nextItems = formItems.filter((_, entryIndex) => entryIndex !== index);
    const discardedServiceNames = new Set(
      [item.serviceName, item.pendingReviewSourceServiceName || ""].filter(
        Boolean,
      ),
    );
    const acknowledgeResidualCurrency =
      isFormItemBlockedByCurrencyReview(item) ||
      isBlockingCurrencyReviewText(item.aiWarning);

    setSaving(true);
    setFormItems(nextItems);
    setExpandedServiceItemKeys((current) =>
      current.filter((key) => key !== item.key),
    );
    try {
      const saved = await saveOrder(
        undefined,
        nextItems,
        undefined,
        {
          discardedServiceNames,
          acknowledgeResidualCurrency,
        },
      );
      if (!saved) return;
      setOrders((previous) =>
        previous.map((order) =>
          order.id === saved.id ? { ...order, ...saved } : order,
        ),
      );
      await load();
      toast.success("Prüfposition verworfen und Auftrag gespeichert.");
    } catch {
      toast.error("Prüfposition konnte nicht verworfen werden.");
    } finally {
      setSaving(false);
    }
  };

  const toggleOrderExecutionAddressEditor = () => {
    if (!form.siteAddressDifferent) return;
    if (!siteAddressEditing) {
      setSiteAddressEditing(true);
      return;
    }
    if (
      serializeOrderExecutionAddressForEdit(form) !==
      executionAddressEditSnapshot
    ) {
      toast.info("Bitte Ausführungsadresse zuerst speichern.");
      return;
    }
    setSiteAddressEditing(false);
  };

  const persistAndAcceptOrderExecutionSiteV17_90L295 = async (
    site: OrderWorkSite,
    targetSiteId?: string | null,
  ) => {
    if (
      !compactText(site.siteAddress) ||
      !compactText(site.sitePlz) ||
      !compactText(site.siteCity)
    ) {
      toast.error("Bitte Strasse, PLZ und Ort des Ausführungsorts ausfüllen.");
      return;
    }

    setSaving(true);
    try {
      let savedCustomerAddress: CustomerExecutionAddress | null = null;
      const shouldPersistCustomerExecutionAddressV17_90L305 =
        shouldPersistCustomerExecutionAddressChoiceV17_90L305(site);
      if (shouldPersistCustomerExecutionAddressV17_90L305) {
        savedCustomerAddress =
          await persistOrderExecutionAddressInCustomerV17_90L295(site);
        if (targetSiteId) {
          setFormWorkSites((current) =>
            current.map((entry) =>
              entry.id === targetSiteId
                ? {
                    ...entry,
                    customerExecutionAddressId: savedCustomerAddress?.id || null,
                  }
                : entry,
            ),
          );
        }
      }

      const isPrimaryEditor = !targetSiteId;
      const hasOpenAddressRoleReview = Boolean(
        isPrimaryEditor &&
          currentEditOrder &&
          hasAddressRoleReviewReasonV17_61(currentEditOrder),
      );
      const saved = hasOpenAddressRoleReview
        ? await persistAddressReviewPatchV17_64(
            {
              siteAddressDifferent: true,
              siteName: cleanWorkSiteDisplayName(form.siteName) || "",
              siteAddress: form.siteAddress.trim(),
              sitePlz: form.sitePlz.trim(),
              siteCity: form.siteCity.trim(),
              siteNote: form.siteNote.trim(),
            },
            formWorkSites,
            { resolveAddressReview: true },
          )
        : await saveOrder();
      if (!saved) return;

      setOrders((prev) => {
        const exists = prev.some((order) => order.id === saved.id);
        return exists
          ? prev.map((order) =>
              order.id === saved.id ? { ...order, ...saved } : order,
            )
          : [saved, ...prev];
      });

      setExecutionAddressEditSnapshot(
        serializeOrderExecutionAddressForEdit(form),
      );
      if (targetSiteId) {
        setEditingWorkSiteId(null);
        setNewItemWorkSiteId("");
      } else {
        setSiteAddressEditing(false);
      }
      await load();
      toast.success(
        shouldPersistCustomerExecutionAddressV17_90L305
          ? "Ausführungsort übernommen und im Kundenprofil gespeichert."
          : "Ausführungsort übernommen.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error && error.message && !error.message.includes("failed")
          ? error.message
          : "Ausführungsort konnte nicht übernommen werden.",
      );
    } finally {
      setSaving(false);
    }
  };

  const saveExecutionAddressFromEditorV17_70 = async () => {
    if (!form.siteAddressDifferent) {
      toast.error("Ausführungsadresse ist nicht aktiviert.");
      return;
    }
    const primarySite =
      formWorkSites.find((entry) => entry.isPrimary) ||
      formWorkSites[0] || {
        id: `local-site-${Date.now().toString(36)}`,
        siteName: form.siteName,
        siteAddress: form.siteAddress,
        sitePlz: form.sitePlz,
        siteCity: form.siteCity,
        siteNote: form.siteNote,
        isPrimary: true,
      };
    await persistAndAcceptOrderExecutionSiteV17_90L295(
      {
        ...primarySite,
        siteName: form.siteName,
        siteAddress: form.siteAddress,
        sitePlz: form.sitePlz,
        siteCity: form.siteCity,
        siteNote: form.siteNote,
      },
      null,
    );
  };

  const acceptOrderWorkSiteV17_90L295 = async (siteId: string) => {
    const site = formWorkSites.find((entry) => entry.id === siteId);
    if (!site) return;
    await persistAndAcceptOrderExecutionSiteV17_90L295(site, siteId);
  };

  const save = async (options?: { closeAfter?: boolean }) => {
    setSaving(true);
    try {
      const saved = await saveOrder();
      if (saved) {
        const successText = editId ? "Auftrag gespeichert" : "Auftrag erstellt";
        toast.success(
          options?.closeAfter
            ? `${successText} und geschlossen`
            : `${successText} ✓`,
        );

        setOrders((prev) => {
          const exists = prev.some((order) => order.id === saved.id);
          if (exists) {
            return prev.map((order) =>
              order.id === saved.id ? { ...order, ...saved } : order,
            );
          }
          return [saved, ...prev];
        });

        if (!editId && saved.id) {
          setEditId(saved.id);
        }

        if (options?.closeAfter) {
          setDialogOpen(false);
        }

        await load();
      }
    } catch {
      toast.error("Fehler");
    } finally {
      setSaving(false);
    }
  };

  const saveAndClose = async () => {
    await save({ closeAfter: true });
  };

  // Save + Create Offer → navigate to /angebote with edit modal open
  const saveAndCreateOffer = async () => {
    setSaving(true);
    try {
      const saved = await saveOrder();
      if (!saved) return;
      if (blockConversionIfUnsafe(saved, "Angebot")) return;
      toast.success("Auftrag gespeichert");

      // Build items for offer
      // V17.90L61: An offer must receive the exact saved order positions.
      // Do not merge "equivalent" rows here: separate work areas can share the
      // same quantity/price and still be distinct contractual positions.
      const orderItems = Array.isArray(saved.items) ? saved.items : [];
      const offerItems = orderItems.map((i: any) => ({
        description: i.serviceName || i.description || "",
        quantity: String(i.quantity ?? 0),
        unit: i.unit ?? "",
        unitPrice: String(i.unitPrice ?? 0),
        siteName: i.workSite?.siteName || null,
        siteAddress: i.workSite?.siteAddress || null,
        sitePlz: i.workSite?.sitePlz || null,
        siteCity: i.workSite?.siteCity || null,
        siteNote: i.workSite?.siteNote || null,
        sourceOrderId:
          i.workSite?.sourceOrderId || i.sourceOrderId || saved.id || null,
      }));

      // Create offer via API — forward VAT from saved order
      const fwdVatRate =
        saved.vatRate != null ? Number(saved.vatRate) : orderVatRate;
      const offerRes = await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: saved.customerId,
          items: offerItems,
          orderIds: [saved.id],
          vatRate: fwdVatRate,
          currency: saved.currency === "EUR" ? "EUR" : "CHF",
        }),
      });
      if (offerRes.ok) {
        const offer = await offerRes.json();
        toast.success(`Angebot ${offer.offerNumber} erstellt`);
        setDialogOpen(false);
        // Paket L: optimistic update — mark the source order as linked so it
        // disappears from the active Orders list immediately (filter uses
        // !offerId && !invoiceId). Backend already set offerId via orderIds
        // link in POST /api/offers. This keeps the list consistent even if
        // the user navigates back before a full reload happens.
        setOrders((prev) =>
          prev.map((o) =>
            o.id === saved.id ? { ...o, offerId: offer.id } : o,
          ),
        );
        window.location.href = "/angebote";
      } else {
        const errorPayload = await offerRes.json().catch(() => null);
        const blockers = formatDocumentApiBlockersV17_90L36(errorPayload);
        toast.error(
          blockers
            ? `Angebot nicht möglich: ${blockers}`
            : errorPayload?.error || "Angebot konnte nicht erstellt werden",
        );
      }
    } catch {
      toast.error("Fehler");
    } finally {
      setSaving(false);
    }
  };

  // Save + Create Invoice → navigate to /rechnungen with edit modal open
  const saveAndCreateInvoice = async () => {
    setSaving(true);
    try {
      const saved = await saveOrder();
      if (!saved) return;
      if (blockConversionIfUnsafe(saved, "Rechnung")) return;
      toast.success("Auftrag gespeichert");

      // Keep every saved position one-to-one. Equivalent rows can belong to
      // different execution sites and must never be merged for an invoice.
      const orderItems = Array.isArray(saved.items) ? saved.items : [];
      const invoiceItems = orderItems.map((i: any) => ({
        description: i.serviceName || i.description || "",
        quantity: String(i.quantity ?? 0),
        unit: i.unit ?? "",
        unitPrice: String(i.unitPrice ?? 0),
        siteName: i.workSite?.siteName || null,
        siteAddress: i.workSite?.siteAddress || null,
        sitePlz: i.workSite?.sitePlz || null,
        siteCity: i.workSite?.siteCity || null,
        siteNote: i.workSite?.siteNote || null,
        sourceOrderId:
          i.workSite?.sourceOrderId || i.sourceOrderId || saved.id || null,
      }));

      // Forward VAT from saved order
      const fwdVatRate =
        saved.vatRate != null ? Number(saved.vatRate) : orderVatRate;
      const invRes = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: saved.customerId,
          items: invoiceItems,
          orderIds: [saved.id],
          vatRate: fwdVatRate,
          currency: saved.currency === "EUR" ? "EUR" : "CHF",
        }),
      });
      if (invRes.ok) {
        const invoice = await invRes.json();
        toast.success(`Rechnung ${invoice.invoiceNumber} erstellt`);
        setDialogOpen(false);
        // Paket L: optimistic update — see saveAndCreateOffer above.
        setOrders((prev) =>
          prev.map((o) =>
            o.id === saved.id ? { ...o, invoiceId: invoice.id } : o,
          ),
        );
        window.location.href = "/rechnungen";
      } else {
        const errorPayload = await invRes.json().catch(() => null);
        const blockers = formatDocumentApiBlockersV17_90L36(errorPayload);
        toast.error(
          blockers
            ? `Rechnung nicht möglich: ${blockers}`
            : errorPayload?.error || "Rechnung konnte nicht erstellt werden",
        );
      }
    } catch {
      toast.error("Fehler");
    } finally {
      setSaving(false);
    }
  };

  const [archiveId, setArchiveId] = useState<string | null>(null);
  // V17.90L192: Auftragsstatus ohne vollständiges Neuladen aktualisieren.
  // Bei einem API-Fehler wird der vorherige Auftrag exakt wiederhergestellt.
  const updateOrderStatus = async (
    e: React.ChangeEvent<HTMLSelectElement>,
    id: string,
    status: string,
  ) => {
    e.stopPropagation();

    const previousOrder = orders.find((order) => order.id === id);
    if (!previousOrder || previousOrder.status === status) return;

    setOrders((current) =>
      current.map((order) =>
        order.id === id ? { ...order, status } : order,
      ),
    );

    try {
      const response = await fetch(`/api/orders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          result?.error || "Auftragsstatus konnte nicht aktualisiert werden.",
        );
      }

      setOrders((current) =>
        current.map((order) =>
          order.id === id
            ? {
                ...order,
                status: String(result?.status || status),
              }
            : order,
        ),
      );
      toast.success("Status aktualisiert");
    } catch (error) {
      setOrders((current) =>
        current.map((order) =>
          order.id === id ? previousOrder : order,
        ),
      );
      toast.error(
        error instanceof Error
          ? error.message
          : "Auftragsstatus konnte nicht aktualisiert werden.",
      );
    }
  };

  const remove = async (id: string) => {
    setArchiveId(id);
  };

  const handleToggleSelect = (orderId: string) => {
    setSelectedOrderIds((prev) => {
      if (prev.includes(orderId)) return prev.filter((id) => id !== orderId);
      if (prev.length >= 5) {
        toast.error("Maximal 5 Aufträge auswählbar");
        return prev;
      }
      return [...prev, orderId];
    });
  };

  // Reset all merge state
  const resetMerge = () => {
    setMergeStep(0);
    setSelectedOrderIds([]);
    setSelectedMainOrderId(null);
    setSelectedCustomerId(null);
    setTextPreviewOpen({});
    setMerging(false);
    setMergePreviewUrls({});
  };

  const handleDialogClose = (open: boolean) => {
    if (!open && !merging) {
      resetMerge();
    }
  };

  const toggleTextPreview = (orderId: string) => {
    setTextPreviewOpen((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
  };

  // Remove order from selection in Step 2
  const handleRemoveFromSelection = (orderId: string) => {
    const newSelection = selectedOrderIds.filter((id) => id !== orderId);

    if (newSelection.length < 2) {
      toast.error("Mindestens 2 Aufträge erforderlich");
      return;
    }

    setSelectedOrderIds(newSelection);

    // If removed order was the main order, clear main selection
    if (selectedMainOrderId === orderId) {
      setSelectedMainOrderId(null);
    }

    // If removed order was the selected customer, reset customer
    const removedOrder = orders.find((o) => o.id === orderId);
    if (removedOrder && selectedCustomerId === removedOrder.customerId) {
      setSelectedCustomerId(null);
    }

    toast.success("Auftrag aus Auswahl entfernt");
  };

  // Count audio orders in selection
  const audioOrdersCount = useMemo(() => {
    const selectedOrders = orders.filter((o) =>
      selectedOrderIds.includes(o.id),
    );
    return selectedOrders.filter((o) => o.mediaUrl && o.mediaType === "audio")
      .length;
  }, [selectedOrderIds, orders]);

  // Step 1 → Step 2: user clicks "Weiter" after selecting 2-5 orders
  const mergeGoToStep2 = async () => {
    if (selectedOrderIds.length < 2) {
      toast.error("Mindestens 2 Aufträge auswählen");
      return;
    }
    const selected = orders.filter((o) => selectedOrderIds.includes(o.id));
    const urlMap: Record<string, string[]> = {};
    await Promise.all(
      selected.map(async (o) => {
        const previewPaths = o.imageUrls?.slice(0, 3) || [];
        if (!previewPaths.length) {
          urlMap[o.id] = [];
          return;
        }
        try {
          const resolved = await Promise.all(
            previewPaths.map((imgPath) => resolveS3Url(imgPath)),
          );
          urlMap[o.id] = resolved;
        } catch {
          urlMap[o.id] = [];
        }
      }),
    );
    setMergePreviewUrls(urlMap);
    // Resolve audio URLs for inline playback
    const audioMap: Record<string, string> = {};
    await Promise.all(
      selected
        .filter((o) => o.mediaUrl && o.mediaType === "audio")
        .map(async (o) => {
          try {
            audioMap[o.id] = await resolveS3Url(o.mediaUrl!);
          } catch {
            /* ignore */
          }
        }),
    );
    setMergeAudioUrls(audioMap);
    const getFullCustomer = (order: Order) => {
      return customers.find((c) => c.id === order.customerId) || order.customer;
    };

    const getBestMainOrder = (ordersToCheck: Order[]) => {
      const scored = ordersToCheck.map((order, index) => {
        const customer = getFullCustomer(order);

        const name = (customer?.name || "").trim();
        const address = (customer?.address || "").trim();
        const plz = (customer?.plz || "").trim();
        const city = (customer?.city || "").trim();
        const phone = (customer?.phone || "").trim();
        const email = (customer?.email || "").trim();
        const customerNumber = (customer?.customerNumber || "").trim();

        const hasRealName = name.length > 0 && !isFallbackCustomerName(name);
        const hasFullName = hasRealName && name.split(/\s+/).length >= 2;
        const hasAddress = address.length > 0;
        const hasPlzCity = plz.length > 0 && city.length > 0;
        const hasContact = phone.length > 0 || email.length > 0;

        let score = 0;

        if (hasRealName) score += 20;
        if (hasFullName) score += 30;
        if (hasAddress) score += 40;
        if (hasPlzCity) score += 40;
        if (hasContact) score += 10;
        if (customerNumber) score += 5;

        return { order, score, index };
      });

      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.index - b.index;
      });

      return scored[0]?.order || ordersToCheck[0];
    };
    const bestMainOrder = getBestMainOrder(selected);

    const defaultMainOrderId = bestMainOrder.id;
    setSelectedMainOrderId(defaultMainOrderId || null);
    const defaultMainOrder = selected.find(
      (o) => o.id === (defaultMainOrderId || selectedOrderIds[0]),
    );
    // Wichtig: keinen alten selectedCustomerId behalten. Der Zielkunde muss
    // immer aus den aktuell ausgewählten Aufträgen stammen.
    setSelectedCustomerId(defaultMainOrder?.customerId || null);
    setMergeStep(2);
  };

  // Step 2 → Step 3

  // Step 3: Execute merge
  const executeMerge = async () => {
    if (merging) return; // GUARD
    if (!selectedMainOrderId) return;

    const selectedForMerge = orders.filter((order) =>
      selectedOrderIds.includes(order.id),
    );
    const mainOrderForMerge = selectedForMerge.find(
      (order) => order.id === selectedMainOrderId,
    );
    const validCustomerIds = new Set(
      selectedForMerge.map((order) => order.customerId).filter(Boolean),
    );
    const safeFinalCustomerId =
      selectedCustomerId && validCustomerIds.has(selectedCustomerId)
        ? selectedCustomerId
        : mainOrderForMerge?.customerId || null;

    if (!safeFinalCustomerId) {
      toast.error("Kunde für Hauptauftrag fehlt");
      return;
    }

    setMerging(true);

    try {
      const response = await fetch("/api/orders/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetOrderId: selectedMainOrderId,
          sourceOrderIds: selectedOrderIds.filter(
            (id) => id !== selectedMainOrderId,
          ),
          finalCustomerId: safeFinalCustomerId || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        toast.error(`Fehler: ${result.error || "Fehler beim Verbinden"}`);
        return;
      }

      toast.success(`${result.mergedCount} Auftrag/Aufträge wurden verbunden`);
      resetMerge();
      await load();
      router.refresh();
    } catch (error) {
      console.error("[MERGE] Error:", error);
      toast.error("Fehler beim Verbinden");
    } finally {
      setMerging(false);
    }
  };

  // Helper: get selected orders objects
  const getSelectedOrders = () =>
    orders.filter((o) => selectedOrderIds.includes(o.id));
  // Helper: unique customers from selected orders
  const getUniqueCustomersFromSelected = () => {
    const selected = getSelectedOrders();
    const custMap = new Map<
      string,
      { id: string; name: string; customerNumber?: string | null }
    >();
    selected.forEach((o) => {
      if (o.customer && o.customerId) {
        custMap.set(o.customerId, {
          id: o.customerId,
          name: o.customer.name,
          customerNumber: o.customer.customerNumber,
        });
      }
    });
    return Array.from(custMap.values());
  };

  const confirmArchive = async () => {
    const targetId = archiveId;
    if (!targetId) return;

    const removedIndex = orders.findIndex((order) => order.id === targetId);
    const removedOrder = removedIndex >= 0 ? orders[removedIndex] : null;
    const restoreOrder = () => {
      if (!removedOrder) return;
      setOrders((current) => {
        if (current.some((order) => order.id === removedOrder.id)) return current;
        const next = [...current];
        next.splice(Math.min(Math.max(removedIndex, 0), next.length), 0, removedOrder);
        return next;
      });
    };

    // Close immediately and remove locally. The server request continues in the
    // background; a failure restores the exact card at its former position.
    setArchiveId(null);
    setOrders((current) => current.filter((order) => order.id !== targetId));

    try {
      const res = await fetch(`/api/orders/${targetId}`, { method: "DELETE" });
      const result = await res.json().catch(() => ({}));

      if (!res.ok) {
        restoreOrder();
        toast.error(result?.error || "Auftrag konnte nicht verschoben werden");
        return;
      }

      if (result?.removedEmptyCustomer && removedOrder?.customerId) {
        setCustomers((current) =>
          current.filter((customer) => customer.id !== removedOrder.customerId),
        );
      }
      toast.success(
        result?.removedEmptyCustomer
          ? "Auftrag in Papierkorb verschoben, leerer Kunde entfernt"
          : "Auftrag in Papierkorb verschoben",
      );
    } catch {
      restoreOrder();
      toast.error("Fehler beim Verschieben in den Papierkorb");
    }
  };

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

  const openMedia = async (o: Order) => {
    const hasImageUrls = (o.imageUrls?.length ?? 0) > 0;

    if (!o.mediaUrl && !hasImageUrls) return;

    if (o.mediaUrl && o.mediaType === "audio") {
      const url = await resolveS3Url(o.mediaUrl);
      setMediaUrl(url);
      setMediaType("audio");
      setGalleryUrls([]);
      setMediaDialogOpen(true);
      return;
    }

    const paths =
      hasImageUrls && o.imageUrls
        ? o.imageUrls
        : o.mediaUrl
          ? [o.mediaUrl]
          : [];

    if (paths.length === 0) return;

    const resolved = await Promise.all(paths.map((p) => resolveS3Url(p)));

    setGalleryUrls(resolved);
    setGalleryIdx(0);
    setMediaType("image");
    setMediaUrl(null);
    setMediaDialogOpen(true);
  };

  useEffect(() => {
    if (!dialogOpen || !currentEditOrder) {
      setCustomerMessageImagePreviewUrls([]);
      return;
    }

    const imagePaths =
      currentEditOrder.imageUrls && currentEditOrder.imageUrls.length > 0
        ? currentEditOrder.imageUrls
        : currentEditOrder.mediaType === "image" && currentEditOrder.mediaUrl
          ? [currentEditOrder.mediaUrl]
          : [];

    if (imagePaths.length === 0) {
      setCustomerMessageImagePreviewUrls([]);
      return;
    }

    let cancelled = false;

    (async () => {
      const resolved = await Promise.all(
        imagePaths.map((path) => resolveS3Url(path)),
      );
      if (!cancelled) {
        setCustomerMessageImagePreviewUrls(resolved);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    dialogOpen,
    currentEditOrder?.id,
    currentEditOrder?.imageUrls?.join("|"),
    currentEditOrder?.mediaUrl,
    currentEditOrder?.mediaType,
  ]);

  const createOffer = async (o: Order) => {
    if (blockConversionIfUnsafe(o, "Angebot")) {
      openEdit(o);
      return;
    }
    const sourceOrder = o;

    // Direct API create — no extra dialog
    // V17.90L61: Preserve every source order item one-to-one in the offer.
    const orderItems = Array.isArray(sourceOrder.items)
      ? sourceOrder.items
      : [];
    const offerItems = orderItems.map((i: any) => ({
      description: i.serviceName || i.description || "",
      quantity: String(i.quantity ?? 0),
      unit: i.unit ?? "",
      unitPrice: String(i.unitPrice ?? 0),
      siteName: i.workSite?.siteName || null,
      siteAddress: i.workSite?.siteAddress || null,
      sitePlz: i.workSite?.sitePlz || null,
      siteCity: i.workSite?.siteCity || null,
      siteNote: i.workSite?.siteNote || null,
      sourceOrderId:
        i.workSite?.sourceOrderId || i.sourceOrderId || sourceOrder.id || null,
    }));
    // Forward the Auftrag's saved VAT rate (falls back to default if legacy order has none)
    const fwdVatRate =
      sourceOrder.vatRate != null
        ? Number(sourceOrder.vatRate)
        : defaultVatRate;
    try {
      const res = await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: sourceOrder.customerId,
          items: offerItems,
          orderIds: [sourceOrder.id],
          vatRate: fwdVatRate,
          currency: sourceOrder.currency === "EUR" ? "EUR" : "CHF",
        }),
      });
      if (res.ok) {
        const offer = await res.json();
        toast.success(`Angebot ${offer.offerNumber} erstellt`);
        // Paket L: optimistic update — mark the source order as linked so it
        // disappears from the active Orders list immediately.
        setOrders((prev) =>
          prev.map((x) =>
            x.id === sourceOrder.id ? { ...x, offerId: offer.id } : x,
          ),
        );
        window.location.href = "/angebote";
      } else {
        const errorPayload = await res.json().catch(() => null);
        const blockers = formatDocumentApiBlockersV17_90L36(errorPayload);
        toast.error(
          blockers
            ? `Angebot nicht möglich: ${blockers}`
            : errorPayload?.error || "Angebot konnte nicht erstellt werden",
        );
      }
    } catch {
      toast.error("Fehler beim Erstellen des Angebots");
    }
  };

  const createInvoice = async (o: Order) => {
    if (blockConversionIfUnsafe(o, "Rechnung")) {
      openEdit(o);
      return;
    }
    const sourceOrder = o;

    // Direct API create — no extra dialog
    // Keep every source position one-to-one. Equivalent rows can belong to
    // different execution sites and must never be merged for an invoice.
    const orderItems = Array.isArray(sourceOrder.items)
      ? sourceOrder.items
      : [];
    const invoiceItems = orderItems.map((i: any) => ({
      description: i.serviceName || i.description || "",
      quantity: String(i.quantity ?? 0),
      unit: i.unit ?? "",
      unitPrice: String(i.unitPrice ?? 0),
      siteName: i.workSite?.siteName || null,
      siteAddress: i.workSite?.siteAddress || null,
      sitePlz: i.workSite?.sitePlz || null,
      siteCity: i.workSite?.siteCity || null,
      siteNote: i.workSite?.siteNote || null,
      sourceOrderId:
        i.workSite?.sourceOrderId || i.sourceOrderId || sourceOrder.id || null,
    }));
    // Forward the Auftrag's saved VAT rate (falls back to default if legacy order has none)
    const fwdVatRate =
      sourceOrder.vatRate != null
        ? Number(sourceOrder.vatRate)
        : defaultVatRate;
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: sourceOrder.customerId,
          items: invoiceItems,
          orderIds: [sourceOrder.id],
          vatRate: fwdVatRate,
          currency: sourceOrder.currency === "EUR" ? "EUR" : "CHF",
        }),
      });
      if (res.ok) {
        const invoice = await res.json();
        toast.success(`Rechnung ${invoice.invoiceNumber} erstellt`);
        // Paket L: optimistic update — mark the source order as linked so it
        // disappears from the active Orders list immediately.
        setOrders((prev) =>
          prev.map((x) =>
            x.id === sourceOrder.id ? { ...x, invoiceId: invoice.id } : x,
          ),
        );
        window.location.href = "/rechnungen";
      } else {
        const errorPayload = await res.json().catch(() => null);
        const blockers = formatDocumentApiBlockersV17_90L36(errorPayload);
        toast.error(
          blockers
            ? `Rechnung nicht möglich: ${blockers}`
            : errorPayload?.error || "Rechnung konnte nicht erstellt werden",
        );
      }
    } catch {
      toast.error("Fehler beim Erstellen der Rechnung");
    }
  };

  // Display items summary for list

  const isBlockedOrderItemForTotal = (
    item: OrderItem,
    reviewReasons?: string[] | null,
  ) => {
    const unitReviewValue = normalizeForMatch(item.unit || "");
    const serviceReviewValue = normalizeForMatch(item.serviceName || "");
    const reviewText = normalizeForMatch(
      [
        item.unit,
        item.serviceName,
        item.description,
        (item as any).sourceText,
        (item as any).evidence,
        (item as any).reviewReason,
      ]
        .filter(Boolean)
        .join(" "),
    );
    const totalPrice = Number((item as any).totalPrice || 0);
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);

    const serviceIsOpen =
      !serviceReviewValue ||
      serviceReviewValue === "leistung pruefen" ||
      serviceReviewValue === "leistung prufen" ||
      serviceReviewValue.includes("leistung suchen") ||
      serviceReviewValue.includes("eingeben");

    const unitIsOpen =
      !unitReviewValue ||
      unitReviewValue === "pruefen" ||
      unitReviewValue === "prufen" ||
      unitReviewValue.includes("einheit pruefen") ||
      unitReviewValue.includes("einheit prufen");

    const hasTrustedNumericAmount =
      quantity > 0 &&
      unitPrice > 0 &&
      (totalPrice > 0 || quantity * unitPrice > 0) &&
      !reviewText.includes("währung/preis noch nicht bestätigt") &&
      !reviewText.includes("waehrung/preis noch nicht bestaetigt") &&
      !reviewText.includes("wahrung/preis noch nicht bestatigt") &&
      !reviewText.includes("currency not confirmed");

    const hasHardCurrencyBlock =
      reviewText.includes("währung/preis noch nicht bestätigt") ||
      reviewText.includes("waehrung/preis noch nicht bestaetigt") ||
      reviewText.includes("wahrung/preis noch nicht bestatigt") ||
      reviewText.includes("currency not confirmed") ||
      reviewText.includes("item currency mismatch") ||
      reviewText.includes("currency_conflict_item");

    // V17.90L278: An unresolved line-local price contradiction is always a
    // hard total blocker, even when an older/stale item payload still carries
    // a positive totalPrice. The editor already shows CHF 0.00; the outer card
    // must use the same effective value and must never recalculate the line.
    const hasActivePriceContradiction = Boolean(
      (reviewReasons || []).some((reason) => {
        const key = String(reason || "");
        if (!key.startsWith("price_contradiction:")) return false;
        const reasonService = key.slice("price_contradiction:".length);
        return reviewServiceNamesMatchV17_90L241(
          reasonService,
          item.serviceName,
        );
      }) ||
        (item.needsReview &&
          (reviewText.includes("preiswiderspruch") ||
            reviewText.includes("price_contradiction") ||
            reviewText.includes("price contradiction"))),
    );

    // V17.90L10: yellow evidence text like "Einheit prüfen: Maschinenpodest"
    // or "Preis im Text unklar" must not remove a complete line from the card
    // total when service, unit, quantity and price are line-local and numeric.
    // Only real hard blockers remove an item from totals.
    return (
      serviceIsOpen ||
      unitIsOpen ||
      hasHardCurrencyBlock ||
      hasActivePriceContradiction ||
      (totalPrice <= 0 && quantity > 0 && unitPrice > 0) ||
      reviewText.includes("leistung oder einheit ist noch unklar") ||
      reviewText.includes("leistung unklar") ||
      reviewText.includes("service action unclear") ||
      reviewText.includes("service_action_unclear") ||
      (!hasTrustedNumericAmount && reviewText.includes("einheit fehlt")) ||
      (!hasTrustedNumericAmount && reviewText.includes("einheit unklar")) ||
      (!hasTrustedNumericAmount && reviewText.includes("unit missing")) ||
      (!hasTrustedNumericAmount && reviewText.includes("unit unclear")) ||
      (!hasTrustedNumericAmount && reviewText.includes("preis pruefen")) ||
      (!hasTrustedNumericAmount && reviewText.includes("preis prufen")) ||
      (!hasTrustedNumericAmount && reviewText.includes("preis fehlt")) ||
      (!hasTrustedNumericAmount && reviewText.includes("preis unklar")) ||
      (!hasTrustedNumericAmount && reviewText.includes("price unclear")) ||
      reviewText.includes("menge pruefen") ||
      reviewText.includes("menge prufen") ||
      reviewText.includes("menge fehlt") ||
      reviewText.includes("nicht in netto") ||
      reviewText.includes("nicht in mwst") ||
      reviewText.includes("nicht in total") ||
      reviewText.includes("not included in total")
    );
  };

  const getSafeOrderNetTotal = (o: Order) => {
    // V17.90L11: Außenkarte und Innenansicht müssen dieselbe berechenbare
    // Positionslogik verwenden. Ein stale/API-Order.totalPrice von 0 darf
    // sichere Positionen wie Anfahrt oder bestätigte CHF-Zeilen nicht auf der
    // Karte verstecken. Die Items sind Source of Truth; blockierte Items haben
    // totalPrice 0 oder werden durch isBlockedOrderItemForTotal ausgeschlossen.
    if (o.items && o.items.length > 0) {
      const itemNetTotal = o.items.reduce((sum, item) => {
        if (isBlockedOrderItemForTotal(item, o.reviewReasons)) return sum;
        if (
          hasCurrencyMismatchReviewForService(o.reviewReasons, item.serviceName)
        ) {
          return sum;
        }

        const qty = Number(item.quantity || 0);
        const price = Number(item.unitPrice || 0);
        const storedLineTotal = Number(item.totalPrice || 0);
        const calculatedLineTotal = qty > 0 && price > 0 ? qty * price : 0;
        const lineTotal =
          storedLineTotal > 0 ? storedLineTotal : calculatedLineTotal;

        return (
          sum + (Number.isFinite(lineTotal) && lineTotal > 0 ? lineTotal : 0)
        );
      }, 0);

      return Number.isFinite(itemNetTotal) && itemNetTotal > 0 ? itemNetTotal : 0;
    }

    const responseNetTotal = Number((o as any).totalPrice ?? NaN);
    if (Number.isFinite(responseNetTotal) && responseNetTotal >= 0) {
      return responseNetTotal;
    }

    const qty = Number(o.quantity || 0);
    const price = Number(o.unitPrice || 0);

    if (qty <= 0 || price <= 0) return 0;

    return qty * price;
  };

  const hasOrderVat = (o: Order) => Number(o.vatRate || 0) > 0;

  const getSafeOrderTotal = (o: Order) => {
    const netTotal = getSafeOrderNetTotal(o);
    const vatRate = Number(o.vatRate || 0);

    if (vatRate <= 0) return netTotal;

    return netTotal + (netTotal * vatRate) / 100;
  };

  const itemsSummary = (o: Order) => {
    if (o.items && o.items.length > 1) {
      return o.items.map((i) => i.serviceName).join(", ");
    }
    return o.serviceName ?? "";
  };
  const shortText = (value?: string | null, max = 90) => {
    const text = (value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max).trim()}…` : text;
  };

  const getMergeMessage = (o: Order) => {
    return shortText(o.notes || o.audioTranscript || null, 120);
  };

  const getMergeAiHint = (o: Order) => {
    const text = shortText(o.description || o.serviceName || null, 70);
    if (!text) return "Bild erkannt. Ohne Nachricht bitte prüfen.";
    return text;
  };

  const formatMergeDate = (date?: string) => {
    if (!date) return "–";

    const dt = new Date(date);

    if (Number.isNaN(dt.getTime())) return "–";

    return dt.toLocaleDateString("de-CH", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
  };

  const renderActiveMobileTooltipSheet = () => {
    if (!activeMobileTooltip) return null;
    const tooltip = cleanVisibleTooltipTextV17_35(activeMobileTooltip.tooltip);
    if (!tooltip) return null;

    const isSpecialNotesSummary = activeMobileTooltip.key.includes(
      ":special_notes_summary:",
    );
    const specialSummarySections = isSpecialNotesSummary
      ? splitSpecialNotesSummaryTooltipV17_91(tooltip)
      : null;
    const isServiceReview = activeMobileTooltip.kind === "service_review";
    const isOrderReview = activeMobileTooltip.kind === "order_review";
    const isExecutionAddress = activeMobileTooltip.kind === "execution_address";
    const isAppointmentTooltip = activeMobileTooltip.kind === "appointment";
    const isOperationalDanger =
      activeMobileTooltip.kind === "operational_danger";
    const isOperationalHint = activeMobileTooltip.kind === "operational_hint";
    const serviceReviewSections = isServiceReview
      ? parseOrderServiceReviewTooltipV17_90L174(tooltip)
      : [];

    const closeSheet = () => {
      setActiveMobileTooltipKey(null);
      setActiveMobileTooltip(null);
      setActiveMobileReviewGroupKey(null);
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
            onPointerDown={clearMobileInfoAutoCloseV17_90L175}
            onPointerUp={scheduleMobileInfoAutoCloseV17_90L175}
            onTouchStart={clearMobileInfoAutoCloseV17_90L175}
            onTouchEnd={scheduleMobileInfoAutoCloseV17_90L175}
            onScroll={clearMobileInfoAutoCloseV17_90L175}
          >
            {isSpecialNotesSummary && specialSummarySections ? (
              <div className="space-y-2">
                {specialSummarySections.safety.length > 0 && (
                  <div className="rounded-lg border border-red-300 bg-red-50 p-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-100">
                    <div className="mb-1 flex items-center gap-1 font-bold">
                      <AlertTriangle className="h-3.5 w-3.5" /> Gefahr / Achtung
                    </div>
                    {specialSummarySections.safety.map((line, index) => (
                      <div
                        key={`active_mobile_compact_summary_safety_${index}`}
                        className="whitespace-pre-wrap break-words"
                      >
                        • {line}
                      </div>
                    ))}
                  </div>
                )}
                {specialSummarySections.primary.length > 0 && (
                  <div className="rounded-lg border border-blue-300 bg-blue-50 p-2 text-blue-900 dark:border-blue-800/70 dark:bg-blue-950/30 dark:text-blue-100">
                    <div className="mb-1 flex items-center gap-1 font-bold"><Info className="h-3.5 w-3.5" /> Wichtige Informationen</div>
                    {specialSummarySections.primary.map((line, index) => (
                      <div key={`active_mobile_compact_summary_primary_${index}`} className="whitespace-pre-wrap break-words">{line}</div>
                    ))}
                  </div>
                )}
                {specialSummarySections.hints.length > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-100">
                    <div className="mb-1 font-bold">Weitere Besonderheiten</div>
                    {specialSummarySections.hints.map((line, index) => (
                      <div
                        key={`active_mobile_compact_summary_hint_${index}`}
                        className="whitespace-pre-wrap break-words"
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : isOrderReview ? (
              <div>
                <div className="mb-2 text-sm font-bold text-slate-950 dark:text-slate-50">
                  {activeMobileTooltip.title || "Auftrag prüfen"}
                </div>
                {renderStructuredRedReviewTooltipV17_90L73(
                  tooltip,
                  "mobile_red_review",
                )}
              </div>
            ) : isExecutionAddress ? (
              <div>{renderExecutionAddressTooltipContentV17_95(tooltip)}</div>
            ) : isAppointmentTooltip ? (
              <div>
                {renderOrderAppointmentTooltipContentV17_90L169(
                  {
                    key: activeMobileTooltip.key.includes("appointments_multiple")
                      ? "appointments_multiple"
                      : activeMobileTooltip.key.includes("appointment_clarify")
                        ? "appointment_clarify"
                        : "appointment",
                    label: activeMobileTooltip.title || "Termin",
                    className: "",
                  },
                  tooltip,
                )}
              </div>
            ) : isOperationalDanger || isOperationalHint ? (
              <div>
                {renderOrderOperationalTooltipContentV17_90L169(
                  {
                    key: activeMobileTooltip.key,
                    label: activeMobileTooltip.title || (isOperationalDanger ? "Achtung" : "Besonderheiten"),
                    className: isOperationalDanger ? "bg-red-100" : "bg-amber-100",
                    focusTarget: "specialNotes",
                  },
                  tooltip,
                )}
              </div>
            ) : (
              <div className="whitespace-pre-wrap break-words">{tooltip}</div>
            )}
          </div>
        </div>
      );
    }

    const sheetTitle = activeMobileTooltip.title || "Leistungen prüfen";
    const reviewGroups = activeMobileTooltip.serviceReviewGroups || [];
    const renderMobileServiceSections = (
      sections: OrderMobileServiceReviewSectionV17_90L174[],
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
          <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3 pb-5">
            {reviewGroups.length > 1 ? (
              <div className="space-y-2">
                {reviewGroups.map((group, groupIndex) => {
                  const active = activeMobileReviewGroupKey === group.key;
                  const groupSections = parseOrderServiceReviewTooltipV17_90L174(
                    group.tooltip,
                  );
                  return (
                    <div
                      key={`order_mobile_group_${group.key}`}
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
                          setActiveMobileReviewGroupKey((current) =>
                            current === group.key ? null : group.key,
                          )
                        }
                      >
                        <span className="min-w-0">
                          <span className="block break-words font-bold text-slate-950 dark:text-slate-50">
                            {groupIndex + 1}. {group.title}
                          </span>
                          <span className="mt-0.5 block break-words text-[11px] text-slate-600 dark:text-slate-300">
                            {group.address || "Adresse nicht angegeben"}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full border border-amber-300 bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-900">
                          Leistungen prüfen · {group.count}
                        </span>
                      </button>
                      {active && (
                        <div className="border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                          {renderMobileServiceSections(
                            groupSections,
                            `order_mobile_group_${group.key}`,
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              renderMobileServiceSections(
                serviceReviewSections,
                "order_mobile_review",
              )
            )}
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (loadError) {
    return <LoadErrorFallback details={loadError} onRetry={load} />;
  }

  return (
    <div className="space-y-4 pb-16 md:pb-8">
      {renderActiveMobileTooltipSheet()}

      <div className="pointer-events-none fixed left-16 top-0 z-40 flex h-14 items-center">
        <span className="font-display text-sm font-bold sm:text-base">Aufträge</span>
      </div>

      <div className="fixed left-1/2 top-0 z-40 flex h-14 -translate-x-1/2 items-center">
        <button
          type="button"
          onClick={() => router.push("/angebote")}
          className="pointer-events-auto inline-flex h-8 items-center gap-1 rounded-full border border-slate-300 bg-background/95 px-2.5 text-xs font-semibold shadow-sm backdrop-blur hover:bg-muted"
          aria-label="Zu Angebote"
          title="Zu Angebote"
        >
          <span className="hidden sm:inline">Angebote</span>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="-mx-2 px-2 py-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {unlinked?.length ?? 0} Aufträge
          </span>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2.5 text-xs"
              onClick={toggleAllOrderCards}
              disabled={visibleOrderIds.length === 0}
            >
              {allVisibleOrderCardsExpanded ? "Alle schließen" : "Alle öffnen"}
            </Button>
          <Button
            className="h-8 px-2.5 text-xs"
            variant={isMergeMode ? "secondary" : "outline"}
            onClick={() => {
              if (isMergeMode) {
                resetMerge();
              } else {
                setMergeStep(1);
                setSelectedOrderIds([]);
                setSelectedMainOrderId(null);
                setSelectedCustomerId(null);
                setTextPreviewOpen({});
              }
            }}
          >
            {isMergeMode ? "Verbinden abbrechen" : "Aufträge verbinden"}
          </Button>
          {isMergeMode && selectedOrderIds.length >= 2 && (
            <Button className="h-8 px-2.5 text-xs" onClick={mergeGoToStep2}>
              Weiter ({selectedOrderIds.length} ausgewählt)
            </Button>
          )}
          {isMergeMode && selectedOrderIds.length === 1 && (
            <span className="text-xs text-muted-foreground self-center">
              Noch mind. 1 weiteren auswählen
            </span>
          )}
          <Button className="h-8 px-2.5 text-xs" onClick={openNew}>
            <Plus className="mr-1 h-4 w-4" />
            <span className="hidden sm:inline">Neuer Auftrag</span>
            <span className="sm:hidden">Neu</span>
          </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            name="smartflow-order-search-query"
            placeholder="Name, Ort, Leistung, Kunden-Nr…"
            className="pl-10 h-9 text-sm"
            value={search}
            autoComplete="off"
            aria-autocomplete="none"
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
            readOnly={!searchInputActive}
            onFocus={() => setSearchInputActive(true)}
            onBlur={() => setSearchInputActive(false)}
            onChange={(e: any) => setSearch(e?.target?.value ?? "")}
          />
        </div>
        <select
          className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9"
          value={statusFilter}
          onChange={(e: any) => setStatusFilter(e?.target?.value ?? "Alle")}
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s === "Alle" ? "Status: Alle" : s}
            </option>
          ))}
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
          <option value="review">Prüfung zuerst</option>
        </select>
      </div>

      <div className="space-y-1.5">
        {filtered?.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            Keine Aufträge gefunden
          </p>
        ) : (
          filtered.slice(0, visibleCount).map((o: Order, i: number) => {
            const cardCustomerFromList =
              customers.find((customer) => customer.id === o.customerId) ||
              null;
            const cardOrderForChips: Order = cardCustomerFromList
              ? {
                  ...o,
                  customer: {
                    ...(o.customer || { name: cardCustomerFromList.name }),
                    name: cardCustomerFromList.name || o.customer?.name || "",
                    phone:
                      cardCustomerFromList.phone || o.customer?.phone || null,
                    email:
                      cardCustomerFromList.email || o.customer?.email || null,
                    address:
                      cardCustomerFromList.address ||
                      o.customer?.address ||
                      null,
                    plz: cardCustomerFromList.plz || o.customer?.plz || null,
                    city: cardCustomerFromList.city || o.customer?.city || null,
                    customerNumber:
                      cardCustomerFromList.customerNumber ||
                      o.customer?.customerNumber ||
                      null,
                  },
                }
              : o;
            const isSonstiges =
              (o.serviceName ?? "").toLowerCase() === "sonstiges" ||
              (o.items &&
                o.items.some(
                  (it) => (it.serviceName ?? "").toLowerCase() === "sonstiges",
                ));
            const serviceLine = getOrderCardServiceSummary(o);
            const mobileServiceLine = getMobileOrderCardServiceSummary(o);
            const mobileOrderServiceRows: ResponsiveOrderServiceRowV17_90L231[] =
              (o.items || [])
                .map((item) => {
                  const name = canonicalServiceNameForOrderItem(
                    item.serviceName || "",
                  );
                  if (!name) return null;
                  const quantity = Number(item.quantity || 0);
                  const unitPrice = Number(item.unitPrice || 0);
                  const storedTotal = Number(item.totalPrice);
                  const calculatedTotal = quantity * unitPrice;
                  const blocked = Boolean(
                    isBlockedOrderItemForTotal(item, o.reviewReasons) ||
                      hasCurrencyMismatchReviewForService(
                        o.reviewReasons,
                        item.serviceName,
                      ),
                  );
                  const amount =
                    Number.isFinite(storedTotal) && storedTotal > 0
                      ? storedTotal
                      : calculatedTotal;
                  const currency =
                    item.currency === "EUR" || item.detectedCurrency === "EUR"
                      ? "EUR"
                      : o.currency === "EUR"
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
                    row,
                  ): row is ResponsiveOrderServiceRowV17_90L231 => Boolean(row),
                );
            if (mobileOrderServiceRows.length === 0 && o.serviceName) {
              mobileOrderServiceRows.push({
                name: canonicalServiceNameForOrderItem(o.serviceName),
                amountLabel: formatCurrency(
                  getSafeOrderTotal(o),
                  o.currency === "EUR" ? "EUR" : "CHF",
                ),
              });
            }
            const mobileOrderServiceNames = mobileOrderServiceRows.map(
              (row) => row.name,
            );
            const mobileOrderServicesExpanded =
              expandedMobileServiceCards.has(o.id);
            const orderCardExpanded = expandedOrderCardIds.has(o.id);
            const parsedCardNotes = splitSpecialNotes(o.specialNotes);
            const systemBadges = getSystemBadges(o, services);
            const amountReviewBadges = buildAmountReviewBadges(
              systemBadges.filter(isAmountReviewBadge),
            );
            const leftSystemBadges = systemBadges.filter(
              (badge) => !isAmountReviewBadge(badge),
            );
            const operationalBadges = getOperationalBadges(cardOrderForChips, parsedCardNotes);
            const bottomBadges = getBottomBadges(cardOrderForChips, parsedCardNotes);
            const hasMultipleMergedData = hasMergedMultipleContactData(
              cardOrderForChips,
              parsedCardNotes,
            );
            const hiddenMergedDataBadgeKeys = [
              "appointment",
              "appointments_multiple",
              "appointment_clarify",
              "callback_request",
              "sms_request",
            ];
            const appointmentBadges = bottomBadges.filter((badge) =>
              // V17.90L177: Auch ein einzelner, nach einem Merge noch gültiger
              // Termin muss außen sichtbar bleiben. Mehrere Termine werden
              // weiterhin als gemeinsamer "Termine · n"-Chip dargestellt.
              badge.key === "appointment" ||
              badge.key === "appointments_multiple",
            );
            const callbackBadges = hasMultipleMergedData
              ? []
              : bottomBadges.filter(
                  (badge) => badge.key === "callback_request",
                );
            const messageBadges = hasMultipleMergedData
              ? []
              : bottomBadges.filter((badge) => badge.key === "sms_request");
            const mergedContactBadges = bottomBadges.filter(
              (badge) => badge.key === "merged_data_review",
            );
            const otherFooterBadges = bottomBadges.filter((badge) =>
              hasMultipleMergedData
                ? !hiddenMergedDataBadgeKeys.includes(badge.key) &&
                  badge.key !== "merged_data_review"
                : ![
                    "appointment",
                    "appointments_multiple",
                    "callback_request",
                    "sms_request",
                    "merged_data_review",
                  ].includes(badge.key),
            );
            const rightSideBadges = amountReviewBadges;
            const serviceReviewBadge =
              rightSideBadges.find((badge) => badge.key === "service_review_summary") || null;
            const otherRightSideBadges = rightSideBadges.filter(
              (badge) => badge.key !== "service_review_summary",
            );
            const orderedRightSideBadges = [
              ...(serviceReviewBadge ? [serviceReviewBadge] : []),
              ...otherRightSideBadges,
            ];
            const mobilePrimaryRightBadges = otherRightSideBadges.slice(0, 2);
            const mobileRightHiddenCount = Math.max(
              0,
              otherRightSideBadges.length - mobilePrimaryRightBadges.length,
            );
            // Mobile: customer/address-state chips belong in the card header near
            // customer number, not in the lower action icon row. On touch they
            // only open the small tooltip; tapping the card itself still opens
            // the order at the relevant section.
            const mobileHeaderBadgeKeys = new Set([
              "site_address",
              "address_review",
              "customer_review",
            ]);
            const mobileFocusBadges = leftSystemBadges.filter(
              (badge) =>
                !mobileHeaderBadgeKeys.has(badge.key) &&
                (badge.focusTarget === "specialNotes" ||
                  badge.focusTarget === "customer" ||
                  badge.focusTarget === "executionAddress"),
            );
            const mobileAddressBadges = leftSystemBadges.filter((badge) =>
              ["site_address", "address_review"].includes(badge.key),
            );
            const compactExecutionAddressBadge =
              mobileAddressBadges.find((badge) => badge.key === "site_address") ||
              null;
            // V17.90L206/L207: Blocking customer/execution-address reviews
            // stay in the same wrapping header row immediately after the
            // execution-site chip. The price has its own grid column, so the
            // header must not reserve an additional 40% width. Only genuine
            // lack of space may move a review chip to the next line.
            const compactHeaderReviewBadges = leftSystemBadges.filter((badge) =>
              ["customer_review", "address_review"].includes(badge.key),
            );
            const mobileSystemBadges = leftSystemBadges.filter(
              (badge) =>
                !["site_address", "address_review", "customer_review"].includes(
                  badge.key,
                ) &&
                (mobileHeaderBadgeKeys.has(badge.key) ||
                  (badge.key !== "site_address" && !badge.focusTarget)),
            );
            // Mobile: do not repeat the address pin as a large action icon.
            // The address remains visible on desktop and in the edit dialog; the
            // mobile icon row is reserved for real actions/hints.
            // V17.90L143: Communication channel chips and explicit callback/SMS
            // actions form one contact group. The separator belongs after the
            // final contact action, never between WhatsApp/SMS and phone.
            const mobileContactActionBadges = [
              ...callbackBadges,
              ...messageBadges,
            ];
            const mobileActionBadges = [
              ...mobileFocusBadges,
              ...operationalBadges,
              ...otherFooterBadges,
            ];
            const mobileAllActionBadges = [
              ...mobileContactActionBadges,
              ...mobileActionBadges,
            ];
            const mobileVisibleActionBadges = mobileAllActionBadges.slice(0, 4);
            const mobileHiddenActionCount = Math.max(
              0,
              mobileAllActionBadges.length - mobileVisibleActionBadges.length,
            );

            const openOrderAtSpecialNotes = (event: any) => {
              event.stopPropagation();
              setActiveMobileTooltipKey(null);
              setActiveMobileTooltip(null);
              openEdit(o, { focusSection: "specialNotes" });
            };

            const openOrderAtCustomer = (event: any) => {
              event.stopPropagation();
              setActiveMobileTooltipKey(null);
              setActiveMobileTooltip(null);
              openEdit(o, { openCustomerSection: true });
            };

            const openOrderAtExecutionAddress = (event: any) => {
              event.stopPropagation();
              setActiveMobileTooltipKey(null);
              setActiveMobileTooltip(null);
              openEdit(o, { focusSection: "executionAddress" });
            };

            const mobileTooltipKey = (badge: ReviewBadge, slot: string) =>
              `${o.id}:${slot}:${badge.key}:${badge.label}`;

            const toggleMobileTooltip = (
              badge: ReviewBadge,
              slot: string,
              event: any,
            ) => {
              event.preventDefault();
              event.stopPropagation();
              const title = String(badge.tooltip || "").trim() || badge.label;
              if (!compactText(title)) return;
              const key = mobileTooltipKey(badge, slot);
              const rect = event.currentTarget?.getBoundingClientRect?.();
              setActiveMobileTooltipKey((current) => {
                const next = current === key ? null : key;
                setActiveMobileTooltip(
                  next
                    ? {
                        key,
                        tooltip: title,
                        title: badge.label,
                        kind:
                          badge.key === "site_address"
                            ? "execution_address"
                            : badge.key === "service_review_summary"
                              ? "service_review"
                              : isAppointmentBadgeV17_90L169(badge)
                                ? "appointment"
                                : isOperationalDetailBadgeV17_90L169(badge)
                                  ? /(?:^|\s)(?:bg|text|border)-red-/.test(
                                      badge.className || "",
                                    )
                                    ? "operational_danger"
                                    : "operational_hint"
                                  : [
                                      "order_review_summary",
                                      "recognition_review",
                                      "currency_review",
                                      "price_quantity",
                                      "unit_conflict",
                                    ].includes(badge.key) &&
                                    /(?:^|\s)(?:bg|text|border)-red-/.test(
                                      badge.className || "",
                                    )
                                    ? "order_review"
                                    : "default",
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
                        serviceReviewGroups:
                          badge.key === "service_review_summary"
                            ? badge.serviceReviewGroups
                            : undefined,
                      }
                    : null,
                );
                return next;
              });
            };

            const renderMobileChipTooltip = (
              badge: ReviewBadge,
              _slot: string,
              _align: "left" | "right" = "left",
            ) => {
              // V17.83: Mobile chip tooltips must be viewport-fixed.
              // The desktop absolute tooltip is anchored to the chip and can run
              // out of the screen on narrow phones. For touch we render the same
              // content as a centered, width-bounded mobile sheet instead.
              if (useTouchChipPopovers) return null;
              return renderBadgeTooltip(badge, _align);
            };

            const openOrderAtItems = (event: any) => {
              event.stopPropagation();
              setActiveMobileTooltipKey(null);
              setActiveMobileTooltip(null);
              openEdit(o, { focusSection: "items" });
            };

            const openOrderForBadgeOnDesktop = (
              badge: ReviewBadge,
              event: any,
            ) => {
              const opensItems =
                isAmountReviewBadge(badge) ||
                badge.focusTarget === "items" ||
                [
                  "service_review_summary",
                  "order_review_summary",
                  "recognition_review",
                  "currency_review",
                  "price_quantity",
                  "unit_conflict",
                ].includes(badge.key);

              if (opensItems) {
                openOrderAtItems(event);
                return;
              }
              if (badge.focusTarget === "customer") {
                openOrderAtCustomer(event);
                return;
              }
              if (
                badge.focusTarget === "executionAddress" ||
                badge.key === "site_address" ||
                badge.key === "address_review"
              ) {
                openOrderAtExecutionAddress(event);
                return;
              }
              if (
                badge.focusTarget === "specialNotes" ||
                [
                  "appointment",
                  "appointments_multiple",
                  "appointment_clarify",
                  "special_notes_summary",
                  "hint_parking",
                ].includes(badge.key)
              ) {
                openOrderAtSpecialNotes(event);
                return;
              }

              event.stopPropagation();
              setActiveMobileTooltipKey(null);
              setActiveMobileTooltip(null);
              openEdit(o);
            };

            const renderInteractiveOrderCardBadge = (
              badge: ReviewBadge,
              tooltipAlign: "left" | "right" = "left",
            ) => {
              const shouldOpenItems = isAmountReviewBadge(badge);
              const shouldOpenSpecialNotes =
                badge.focusTarget === "specialNotes";
              const shouldOpenCustomer = badge.focusTarget === "customer";
              const shouldOpenExecutionAddress =
                badge.focusTarget === "executionAddress";

              if (
                !shouldOpenItems &&
                !shouldOpenSpecialNotes &&
                !shouldOpenCustomer &&
                !shouldOpenExecutionAddress
              ) {
                return renderOrderCardBadge(badge, tooltipAlign);
              }

              const isCompactReviewChip = isAmountReviewBadge(badge);
              const isLargeYellowBadge = [
                "price_deviation",
                "catalog_missing",
                "catalog_review_combined",
                "service_review_summary",
                "order_review_summary",
                "merged_data_review",
              ].includes(badge.key);

              const CompactIcon = compactIconForBadge(badge);
              const compactSymbol = compactSymbolForBadge(badge);
              const isCompactIcon = Boolean(CompactIcon || compactSymbol);
              const title = compactText(badge.tooltip) || badge.label;

              return (
                <button
                  key={badge.key}
                  type="button"
                  aria-label={title}
                  onClick={
                    shouldOpenItems
                      ? openOrderAtItems
                      : shouldOpenCustomer
                        ? openOrderAtCustomer
                        : shouldOpenExecutionAddress
                          ? openOrderAtExecutionAddress
                          : openOrderAtSpecialNotes
                  }
                  className={`group relative inline-flex shrink-0 items-center outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ${
                    isCompactReviewChip
                      ? "h-7 min-w-7 justify-center gap-1 rounded-full px-2 py-0 text-[10px] font-bold"
                      : `${isCompactIcon ? "h-7 w-7 justify-center rounded-lg px-0 py-0 text-[15px]" : "rounded-full"} ${
                          isCompactIcon
                            ? "font-semibold"
                            : isLargeYellowBadge
                              ? "text-[11px] px-2 py-0.5 font-semibold"
                              : "text-[10px] px-1.5 py-0.5 font-medium"
                        }`
                  } ${getStrongerCardBadgeClassName(badge.className)}`}
                >
                  {isCompactReviewChip ? (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>{compactAmountReviewCountV17_90L165(badge)}</span>
                    </>
                  ) : CompactIcon ? (
                    <CompactIcon className="h-5 w-5" />
                  ) : compactSymbol ? (
                    <span aria-hidden="true" className="leading-none">
                      {compactSymbol}
                    </span>
                  ) : (
                    <>
                      {badge.icon && badge.key !== "callback_request" && (
                        <AlertTriangle className="w-3 h-3" />
                      )}
                      {badge.label}
                    </>
                  )}
                  {renderBadgeTooltip(badge, tooltipAlign)}
                </button>
              );
            };

            const renderInteractiveMobileActionBadge = (badge: ReviewBadge) => {
              if (badge.key === "callback_request") {
                return renderMobileActionBadge(cardOrderForChips, badge);
              }

              const Icon = mobileIconForBadge(badge) || AlertTriangle;
              const title = compactText(badge.tooltip) || badge.label;
              const tooltipSlot = "mobile_action";
              const isGenericDangerWarning = badge.key === "danger_warning";

              // V17.80: Auf Handy sollen Besonderheiten-Chips (Hund, Schlüssel,
              // Leiter, Zugang, Nicht-einfach-kommen usw.) beim Antippen die
              // gleiche Info zeigen wie Desktop-Hover. Sie öffnen NICHT mehr
              // direkt den Auftrag. Die Karte selbst bleibt der Öffnen-Tap.
              return (
                <button
                  key={badge.key}
                  type="button"
                  aria-label={title}
                  onPointerDown={(event) => event.stopPropagation()}
                  onTouchStart={(event) => event.stopPropagation()}
                  onClick={(event) =>
                    useTouchChipPopovers
                      ? toggleMobileTooltip(badge, tooltipSlot, event)
                      : openOrderForBadgeOnDesktop(badge, event)
                  }
                  className={`group relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-semibold focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ${
                    isGenericDangerWarning
                      ? "border-2 text-[17px]"
                      : "border text-[13px] shadow-sm"
                  } ${mobileIconBadgeClass(badge)}`}
                >
                  <Icon
                    className={
                      badge.key === "danger_dog"
                        ? "h-5 w-5"
                        : isGenericDangerWarning
                          ? "h-4 w-4"
                          : "h-3.5 w-3.5"
                    }
                    strokeWidth={2.2}
                  />
                  {renderMobileChipTooltip(badge, tooltipSlot, "left")}
                </button>
              );
            };

            const renderInteractiveMobileTextBadge = (
              badge: ReviewBadge,
              slot: string,
              align: "left" | "right" = "right",
              prominent = false,
            ) => {
              const title = compactText(badge.tooltip) || badge.label;
              return (
                <button
                  key={`${slot}_${badge.key}`}
                  type="button"
                  aria-label={title}
                  onPointerDown={(event) => event.stopPropagation()}
                  onTouchStart={(event) => event.stopPropagation()}
                  onClick={(event) =>
                    useTouchChipPopovers
                      ? toggleMobileTooltip(badge, slot, event)
                      : openOrderForBadgeOnDesktop(badge, event)
                  }
                  className={`group relative inline-flex max-w-full shrink-0 items-center rounded-full font-semibold outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ${
                    prominent
                      ? "min-h-9 px-3 py-1.5 text-xs shadow-sm"
                      : "px-1.5 py-0.5 text-[10px]"
                  } ${getStrongerCardBadgeClassName(badge.className)}`}
                >
                  <span className="truncate">{badge.label}</span>
                  {renderMobileChipTooltip(badge, slot, align)}
                </button>
              );
            };

            const renderDirectHeaderReviewBadge = (badge: ReviewBadge) => {
              const title = compactText(badge.tooltip) || badge.label;
              const opensCustomer = badge.focusTarget === "customer";
              return (
                <button
                  key={`header_review_${badge.key}`}
                  type="button"
                  aria-label={title}
                  onPointerDown={(event) => event.stopPropagation()}
                  onTouchStart={(event) => event.stopPropagation()}
                  onClick={(event) =>
                    opensCustomer
                      ? openOrderAtCustomer(event)
                      : openOrderAtExecutionAddress(event)
                  }
                  className={`group relative inline-flex min-h-7 max-w-full shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ${getStrongerCardBadgeClassName(
                    badge.className,
                  )}`}
                >
                  {badge.icon && <AlertTriangle className="h-3 w-3 shrink-0" />}
                  <span className="truncate">{badge.label}</span>
                  {renderBadgeTooltip(badge, "left")}
                </button>
              );
            };

            const renderResponsiveAppointmentBadge = (
              badge: ReviewBadge,
              slot: string,
              align: "left" | "right" = "left",
            ) => {
              const title = compactText(badge.tooltip) || badge.label;
              const appointmentLabels = buildAdaptiveAppointmentLabels(badge.label);
              return (
                <button
                  key={`${slot}_${badge.key}`}
                  type="button"
                  aria-label={title}
                  onPointerDown={(event) => event.stopPropagation()}
                  onTouchStart={(event) => event.stopPropagation()}
                  onClick={(event) =>
                    useTouchChipPopovers
                      ? toggleMobileTooltip(badge, slot, event)
                      : openOrderForBadgeOnDesktop(badge, event)
                  }
                  className={`group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full px-0 text-xs font-semibold shadow-sm outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ${appointmentLabels.dateOnly ? "md:w-auto md:px-2.5" : "md:w-8 md:px-0"} ${getStrongerCardBadgeClassName(badge.className)}`}
                >
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                  {appointmentLabels.dateOnly && (
                    <span className="hidden whitespace-nowrap md:ml-1.5 md:inline">
                      {appointmentLabels.dateOnly}
                    </span>
                  )}
                  <span className="sr-only">{appointmentLabels.full}</span>
                  {renderMobileChipTooltip(badge, slot, align)}
                </button>
              );
            };

            const renderInteractiveMobileRightReviewBadge = (
              badge: ReviewBadge,
            ) => {
              const title = compactText(badge.tooltip) || badge.label;
              return (
                <button
                  key={`mobile_right_${badge.key}`}
                  type="button"
                  aria-label={title}
                  onPointerDown={(event) => event.stopPropagation()}
                  onTouchStart={(event) => event.stopPropagation()}
                  onClick={(event) =>
                    useTouchChipPopovers
                      ? toggleMobileTooltip(badge, "mobile_right", event)
                      : openOrderForBadgeOnDesktop(badge, event)
                  }
                  className={`group relative inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-full px-2 py-0 text-[10px] font-bold outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ${getStrongerCardBadgeClassName(badge.className)}`}
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>{compactAmountReviewCountV17_90L165(badge)}</span>
                  {renderMobileChipTooltip(badge, "mobile_right", "right")}
                </button>
              );
            };

            const showAudioTooLongBadge =
              o.audioTranscriptionStatus?.startsWith("skipped");
            const showImageOnlyBadge = false;
            const isSelected = selectedOrderIds.includes(o.id);
            return (
              <motion.div
                key={o.id}
                data-order-card-wrapper
                className="relative"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.015 }}
              >
                <Card
                  className={`border-2 border-slate-400 dark:border-slate-600 hover:border-slate-500 dark:hover:border-slate-500 hover:shadow-sm transition-all tap-safe max-w-full overflow-visible active:scale-[0.998] ${isMergeMode && isSelected ? "ring-2 ring-primary/40" : ""}`}
                  aria-expanded={orderCardExpanded}
                  onClick={(event) => {
                    if (
                      event.target instanceof Element &&
                      event.target.closest(
                        "button, a, input, select, textarea, label, summary, details, [role='button'], [data-card-toggle-ignore='true']",
                      )
                    )
                      return;
                    setActiveMobileTooltipKey(null);
                    setActiveMobileTooltip(null);
                    if (isMergeMode) {
                      handleToggleSelect(o.id);
                      return;
                    }
                    toggleOrderCard(o.id);
                  }}
                >
                  <CardContent className="px-2.5 py-1.5 sm:px-3 sm:py-2 max-w-full overflow-visible">
                    <div className="flex items-start gap-2 min-w-0 max-w-full overflow-visible">
                      {isMergeMode && (
                        <div
                          className="shrink-0 pt-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelect(o.id)}
                            className="h-4 w-4 rounded border-gray-300"
                            aria-label="Auftrag für Zusammenführung auswählen"
                          />
                        </div>
                      )}
                      {/* Left: 3-dot menu */}
                      <details
                        data-order-action-menu
                        data-card-toggle-ignore="true"
                        className="relative shrink-0 group"
                        onToggle={(event) => {
                          const wrapper = event.currentTarget.closest(
                            "[data-order-card-wrapper]",
                          );
                          if (wrapper instanceof HTMLElement) {
                            wrapper.style.zIndex = event.currentTarget.open
                              ? "10000"
                              : "";
                          }
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onTouchStart={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
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
                              openEdit(o);
                            }}
                            className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                          >
                            <ClipboardList className="w-3.5 h-3.5 text-primary" />
                            Bearbeiten
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const menu = e.currentTarget.closest("details");
                              if (menu instanceof HTMLDetailsElement) menu.open = false;
                              createOffer(o);
                            }}
                            className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                          >
                            <FileCheck className="w-3.5 h-3.5 text-orange-600" />
                            Zu Angebot
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const menu = e.currentTarget.closest("details");
                              if (menu instanceof HTMLDetailsElement) menu.open = false;
                              createInvoice(o);
                            }}
                            className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                          >
                            <FileText className="w-3.5 h-3.5 text-blue-600" />
                            Zu Rechnung
                          </button>
                          <div className="border-t my-0.5" />
                          <button
                            type="button"
                            data-card-toggle-ignore="true"
                            onPointerDown={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                            onTouchStart={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              setArchiveId(o.id);
                              const menu = event.currentTarget.closest("details");
                              if (menu instanceof HTMLDetailsElement) menu.open = false;
                            }}
                            className="w-full px-3 py-1.5 text-left text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 flex items-center gap-2"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Papierkorb
                          </button>
                        </div>
                      </details>

                      {/* Mobile — shared one-column card for Auftrag/Angebot */}
                      {!orderCardExpanded && (
                        <div
                          className="min-w-0 flex-1 cursor-pointer rounded-lg px-1.5 py-1 transition-colors hover:bg-slate-100 active:bg-slate-200 dark:hover:bg-slate-800/80 dark:active:bg-slate-700"
                          onClick={(event) => {
                            event.stopPropagation();
                            setActiveMobileTooltipKey(null);
                            setActiveMobileTooltip(null);
                            if (isMergeMode) {
                              handleToggleSelect(o.id);
                              return;
                            }
                            toggleOrderCard(o.id);
                          }}
                        >
                          <div className="relative grid min-w-0 grid-cols-1 items-start gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto]">
                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-visible">
                                <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground sm:text-[11px]">
                                  {o.createdAt
                                    ? `${new Date(o.createdAt).toLocaleDateString("de-CH", {
                                        day: "2-digit",
                                        month: "2-digit",
                                      })} ${new Date(o.createdAt).toLocaleTimeString("de-CH", {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}`
                                    : ""}
                                </span>
                                <span
                                  className={`min-w-0 max-w-[20rem] shrink truncate text-sm font-semibold ${
                                    isFallbackCustomerName(o.customer?.name)
                                      ? "italic text-amber-600 dark:text-amber-400"
                                      : "text-foreground"
                                  }`}
                                >
                                  {isFallbackCustomerName(o.customer?.name)
                                    ? "Kunde nicht zugeordnet"
                                    : o.customer?.name || "–"}
                                </span>
                                {!isFallbackCustomerName(o.customer?.name) &&
                                  cardOrderForChips.customer?.customerNumber && (
                                    <span className="shrink-0 text-[11px] text-muted-foreground">
                                      ({cardOrderForChips.customer.customerNumber})
                                    </span>
                                  )}
                                {compactExecutionAddressBadge && (
                                  <span className="min-w-0 basis-full max-w-full shrink overflow-hidden sm:basis-auto sm:flex-none sm:max-w-[18rem]">
                                    {renderInteractiveMobileTextBadge(
                                      compactExecutionAddressBadge,
                                      "compact_header_address",
                                      "left",
                                    )}
                                  </span>
                                )}
                                {compactHeaderReviewBadges.map((badge) => (
                                  <span
                                    key={`compact_header_review_${badge.key}`}
                                    className="min-w-0 max-w-full shrink-0"
                                  >
                                    {renderDirectHeaderReviewBadge(badge)}
                                  </span>
                                ))}
                              </div>
                              <div className="mt-1 text-[10px] font-medium text-muted-foreground sm:text-[11px]">
                                Leistungen · {mobileOrderServiceNames.length}
                              </div>
                              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 overflow-visible border-t border-slate-200 pt-2 dark:border-slate-700">
                                <select
                                  onClick={(event) => event.stopPropagation()}
                                  className="h-7 shrink-0 rounded-lg border px-2 text-[11px] font-medium"
                                  style={getStatusStyle(
                                    ORDER_STATUS_STYLES,
                                    o?.status ?? "",
                                  )}
                                  value={o?.status ?? ""}
                                  onChange={(event: any) =>
                                    updateOrderStatus(
                                      event,
                                      o?.id,
                                      event?.target?.value ?? "",
                                    )
                                  }
                                >
                                  {orderStatuses.map((status) => (
                                    <option
                                      key={status}
                                      style={getStatusStyle(
                                        ORDER_STATUS_STYLES,
                                        status,
                                      )}
                                    >
                                      {status}
                                    </option>
                                  ))}
                                </select>
                                {!hasMultipleMergedData && (
                                  <div
                                    className="mr-1 inline-flex items-center gap-1.5 border-r border-slate-200 pr-2 empty:hidden dark:border-slate-700 [&_svg]:h-[18px] [&_svg]:w-[18px]"
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onTouchStart={(event) => event.stopPropagation()}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <CommunicationChips
                                      compact
                                      data={buildCommunicationChipDataV17_52(cardOrderForChips)}
                                      onAudioClick={() => openMedia(o)}
                                      onImageClick={() => openMedia(o)}
                                    />
                                    {mobileContactActionBadges.map((badge) =>
                                      renderInteractiveMobileActionBadge(badge),
                                    )}
                                  </div>
                                )}

                                {hasMultipleMergedData && (
                                  <span className="mr-1 inline-flex border-r border-slate-200 pr-2 dark:border-slate-700">
                                    <MergedContactReviewChip
                                      records={[cardOrderForChips as any]}
                                      compact
                                    />
                                  </span>
                                )}

                                {mobileActionBadges.map((badge) =>
                                  renderInteractiveMobileActionBadge(badge),
                                )}
                                {useTouchChipPopovers ? (
                                  (orderedRightSideBadges.length > 0 || appointmentBadges.length > 0) && (
                                    <span className="ml-auto inline-flex shrink-0 items-center border-l border-slate-200 pl-2 dark:border-slate-700">
                                      <span className="inline-flex items-center gap-1.5">
                                        {orderedRightSideBadges.map((badge) =>
                                          renderInteractiveMobileRightReviewBadge(badge),
                                        )}
                                        {appointmentBadges.slice(0, 1).map((badge) => (
                                          <span key={`compact_touch_appointment_${badge.key}`} className="inline-flex shrink-0">
                                            {renderResponsiveAppointmentBadge(
                                              badge,
                                              "compact_touch_appointment",
                                              "left",
                                            )}
                                          </span>
                                        ))}
                                      </span>
                                    </span>
                                  )
                                ) : (
                                  <>
                                    {(orderedRightSideBadges.length > 0 || appointmentBadges.length > 0) && (
                                      <span className="inline-flex items-center border-l border-slate-200 pl-2 dark:border-slate-700 sm:ml-auto sm:pl-3 md:absolute md:bottom-0 md:left-[64%] md:right-40 md:ml-0 md:justify-center md:pr-3">
                                        <span className="inline-flex items-center gap-1.5">
                                          {orderedRightSideBadges.map((badge) =>
                                            renderInteractiveMobileRightReviewBadge(badge),
                                          )}
                                          {appointmentBadges.slice(0, 1).map((badge) => (
                                            <span key={`compact_desktop_appointment_${badge.key}`} className="inline-flex shrink-0">
                                              {renderResponsiveAppointmentBadge(
                                                badge,
                                                "compact_desktop_appointment",
                                                "left",
                                              )}
                                            </span>
                                          ))}
                                        </span>
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                              <div className="mt-2 flex items-center justify-end gap-2 border-t border-slate-200 pt-2 dark:border-slate-700 sm:hidden">
                                <div className="shrink-0 text-right">
                                  <div className="font-mono text-sm font-bold tabular-nums">
                                    {formatCurrency(
                                      getSafeOrderTotal(o),
                                      o.currency === "EUR" ? "EUR" : "CHF",
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
                                      getSafeOrderTotal(o),
                                      o.currency === "EUR" ? "EUR" : "CHF",
                                    )}
                                  </div>
                                </div>
                                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      <div className={`min-w-0 flex-1 ${orderCardExpanded ? "" : "hidden"}`}>
                        <div
                          className="flex min-w-0 cursor-pointer flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg px-1.5 py-1 transition-colors hover:bg-blue-50/80 active:bg-blue-100 dark:hover:bg-slate-800/60 dark:active:bg-slate-700"
                          onClick={(event) => {
                            event.stopPropagation();
                            setActiveMobileTooltipKey(null);
                            setActiveMobileTooltip(null);
                            if (isMergeMode) {
                              handleToggleSelect(o.id);
                              return;
                            }
                            toggleOrderCard(o.id);
                          }}
                        >
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {o.createdAt
                              ? `${new Date(o.createdAt).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })} · ${new Date(o.createdAt).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}`
                              : ""}
                          </span>
                          <span
                            className={`min-w-0 max-w-[20rem] shrink truncate text-[15px] font-semibold ${isFallbackCustomerName(o.customer?.name) ? "text-amber-600 dark:text-amber-400 italic" : "text-foreground"}`}
                          >
                            {isFallbackCustomerName(o.customer?.name)
                              ? "Kunde nicht zugeordnet"
                              : o.customer?.name || "–"}
                          </span>
                          {!isFallbackCustomerName(o.customer?.name) &&
                            o.customer?.customerNumber && (
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                ({o.customer.customerNumber})
                              </span>
                            )}
                          {compactExecutionAddressBadge && (
                            <span className="min-w-0 basis-full max-w-full shrink overflow-hidden sm:basis-auto sm:flex-none sm:max-w-[18rem]">
                              {renderInteractiveMobileTextBadge(
                                compactExecutionAddressBadge,
                                "mobile_header_address",
                                "left",
                              )}
                            </span>
                          )}
                          {compactHeaderReviewBadges.map((badge) => (
                            <span
                              key={`mobile_header_review_${badge.key}`}
                              className="min-w-0 max-w-full shrink-0"
                            >
                              {renderDirectHeaderReviewBadge(badge)}
                            </span>
                          ))}
                        </div>

                        {mobileSystemBadges.length > 0 && (
                          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
                            {mobileSystemBadges
                              .slice(0, 3)
                              .map((badge) =>
                                renderInteractiveMobileTextBadge(
                                  badge,
                                  "mobile_system",
                                  "left",
                                ),
                              )}
                          </div>
                        )}

                        <ResponsiveOrderServicePreviewV17_95
                          orderId={o.id}
                          services={mobileOrderServiceRows}
                          expanded={mobileOrderServicesExpanded}
                          onToggle={() => toggleMobileServiceCard(o.id)}
                          onOpenItems={() => openEdit(o, { focusSection: "items" })}
                        />

                        <div
                          className="relative mt-1.5 flex min-h-8 min-w-0 cursor-pointer flex-wrap items-center gap-1.5 overflow-visible rounded-lg px-1.5 py-1 transition-colors hover:bg-blue-50/80 active:bg-blue-100 dark:hover:bg-slate-800/60 dark:active:bg-slate-700"
                          onClick={(event) => {
                            if (
                              event.target instanceof Element &&
                              event.target.closest(
                                "button, a, input, select, textarea, label, summary, details, [role='button'], [data-card-toggle-ignore='true']",
                              )
                            )
                              return;
                            event.stopPropagation();
                            setActiveMobileTooltipKey(null);
                            setActiveMobileTooltip(null);
                            if (isMergeMode) {
                              handleToggleSelect(o.id);
                              return;
                            }
                            toggleOrderCard(o.id);
                          }}
                        >
                          <select
                            onClick={(event) => event.stopPropagation()}
                            className="h-8 shrink-0 rounded-lg border px-2 text-[11px] font-medium"
                            style={getStatusStyle(
                              ORDER_STATUS_STYLES,
                              o?.status ?? "",
                            )}
                            value={o?.status ?? ""}
                            onChange={(event: any) =>
                              updateOrderStatus(
                                event,
                                o?.id,
                                event?.target?.value ?? "",
                              )
                            }
                          >
                            {orderStatuses.map((status) => (
                              <option
                                key={status}
                                style={getStatusStyle(ORDER_STATUS_STYLES, status)}
                              >
                                {status}
                              </option>
                            ))}
                          </select>

                          {!hasMultipleMergedData && (
                            <div
                              className="mr-1 inline-flex items-center gap-1.5 border-r border-slate-200 pr-2 empty:hidden dark:border-slate-700 [&_svg]:h-[18px] [&_svg]:w-[18px]"
                              onPointerDown={(event) => event.stopPropagation()}
                              onTouchStart={(event) => event.stopPropagation()}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <CommunicationChips
                                compact
                                data={buildCommunicationChipDataV17_52(cardOrderForChips)}
                                onAudioClick={() => openMedia(o)}
                                onImageClick={() => openMedia(o)}
                              />
                              {mobileContactActionBadges.map((badge) =>
                                renderInteractiveMobileActionBadge(badge),
                              )}
                            </div>
                          )}

                          {hasMultipleMergedData && (
                            <span className="mr-1 inline-flex border-r border-slate-200 pr-2 dark:border-slate-700">
                              <MergedContactReviewChip
                                records={[cardOrderForChips as any]}
                                compact
                              />
                            </span>
                          )}

                          {mobileActionBadges.map((badge) =>
                            renderInteractiveMobileActionBadge(badge),
                          )}

                          {useTouchChipPopovers ? (
                            (orderedRightSideBadges.length > 0 || appointmentBadges.length > 0) && (
                              <span className="ml-auto inline-flex shrink-0 items-center border-l border-slate-200 pl-2 dark:border-slate-700">
                                <span className="inline-flex items-center gap-1.5">
                                  {orderedRightSideBadges.map((badge) =>
                                    renderInteractiveMobileRightReviewBadge(badge),
                                  )}
                                  {appointmentBadges.slice(0, 1).map((badge) => (
                                    <span key={`expanded_touch_appointment_${badge.key}`} className="inline-flex shrink-0">
                                      {renderResponsiveAppointmentBadge(
                                        badge,
                                        "expanded_touch_appointment",
                                        "left",
                                      )}
                                    </span>
                                  ))}
                                </span>
                              </span>
                            )
                          ) : (
                            <>
                              {(orderedRightSideBadges.length > 0 || appointmentBadges.length > 0) && (
                                <span className="inline-flex items-center border-l border-slate-200 pl-2 dark:border-slate-700 sm:ml-auto sm:pl-3 md:absolute md:left-[64%] md:right-40 md:top-1/2 md:ml-0 md:-translate-y-1/2 md:justify-center md:pr-3">
                                  <span className="inline-flex items-center gap-1.5">
                                    {orderedRightSideBadges.map((badge) =>
                                      renderInteractiveMobileRightReviewBadge(badge),
                                    )}
                                    {appointmentBadges.slice(0, 1).map((badge) => (
                                      <span key={`expanded_desktop_appointment_${badge.key}`} className="inline-flex shrink-0">
                                        {renderResponsiveAppointmentBadge(
                                          badge,
                                          "expanded_desktop_appointment",
                                          "left",
                                        )}
                                      </span>
                                    ))}
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
                            setActiveMobileTooltipKey(null);
                            setActiveMobileTooltip(null);
                            if (isMergeMode) {
                              handleToggleSelect(o.id);
                              return;
                            }
                            toggleOrderCard(o.id);
                          }}
                        >
                          <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:flex" />

                          <div className="ml-auto flex shrink-0 items-end gap-3 sm:flex-col sm:items-end sm:gap-2 sm:border-l sm:border-slate-200 sm:pl-3 sm:dark:border-slate-700">
                            <div className="shrink-0 whitespace-nowrap text-right leading-tight">
                              <div className="font-mono text-[16px] font-bold tabular-nums">
                                {formatCurrency(
                                  getSafeOrderTotal(o),
                                  o.currency === "EUR" ? "EUR" : "CHF",
                                )}
                              </div>
                              {hasOrderVat(o) && (
                                <div className="text-[9px] leading-none text-muted-foreground">
                                  inkl. MwSt
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Desktop/tablet: existing dense list layout */}
                      <div className="hidden min-w-0 flex-1 items-stretch gap-2 sm:gap-3">
                        <div className="flex-1 min-w-0 max-w-full overflow-visible">
                          {/* Row 1: date + customer */}
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs min-w-0 max-w-full overflow-visible">
                            <span className="text-muted-foreground shrink-0">
                              {o.createdAt
                                ? new Date(o.createdAt).toLocaleDateString(
                                    "de-CH",
                                    { day: "2-digit", month: "2-digit" },
                                  ) +
                                  " " +
                                  new Date(o.createdAt).toLocaleTimeString(
                                    "de-CH",
                                    { hour: "2-digit", minute: "2-digit" },
                                  )
                                : ""}
                            </span>
                            <span className="text-muted-foreground shrink-0">
                              ·
                            </span>
                            <span
                              className={`font-medium truncate min-w-0 max-w-[120px] sm:max-w-[170px] md:max-w-[220px] lg:max-w-[280px] xl:max-w-none ${isFallbackCustomerName(o.customer?.name) ? "text-amber-600 dark:text-amber-400 italic" : "text-foreground"}`}
                            >
                              {isFallbackCustomerName(o.customer?.name)
                                ? "Kunde nicht zugeordnet"
                                : o.customer?.name || "–"}
                            </span>

                            {!isFallbackCustomerName(o.customer?.name) &&
                              o.customer?.customerNumber && (
                                <span className="text-muted-foreground shrink-0">
                                  ({o.customer.customerNumber})
                                </span>
                              )}

                            {leftSystemBadges.length > 0 && (
                              <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1">
                                {leftSystemBadges.map((badge) =>
                                  renderInteractiveOrderCardBadge(badge),
                                )}
                              </span>
                            )}

                            {showAudioTooLongBadge && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300 shrink-0">
                                ⚠️ Audio zu lang
                              </span>
                            )}
                          </div>

                          {/* Row 2: compact service-only preview */}
                          <div className="mt-0.5 text-[10px] font-semibold text-muted-foreground">
                            {mobileOrderServiceNames.length} Leistungen
                          </div>
                          <p
                            className={`text-sm font-medium mt-0.5 whitespace-normal break-words max-md:line-clamp-5 max-md:overflow-hidden max-md:leading-snug ${
                              isSonstiges
                                ? "text-red-600 dark:text-red-400"
                                : "text-foreground"
                            }`}
                          >
                            {isSonstiges && "⚠ "}
                            {serviceLine}
                          </p>

                          {/* Row 3: compact footer chips */}
                          <div className="flex flex-wrap items-center gap-1.5 mt-1 max-w-full overflow-visible pr-1 sm:pr-0">
                            <select
                              onClick={(e) => e.stopPropagation()}
                              className="text-[11px] border rounded px-1.5 py-0.5 font-medium shrink-0"
                              style={getStatusStyle(
                                ORDER_STATUS_STYLES,
                                o?.status ?? "",
                              )}
                              value={o?.status ?? ""}
                              onChange={(e: any) =>
                                updateOrderStatus(
                                  e,
                                  o?.id,
                                  e?.target?.value ?? "",
                                )
                              }
                            >
                              {orderStatuses.map((s) => (
                                <option
                                  key={s}
                                  style={getStatusStyle(ORDER_STATUS_STYLES, s)}
                                >
                                  {s}
                                </option>
                              ))}
                            </select>

                            {!hasMultipleMergedData && (
                              <div
                                className="mr-1 inline-flex items-center gap-1.5 border-r border-slate-200 pr-2 empty:hidden dark:border-slate-700 [&_svg]:h-[18px] [&_svg]:w-[18px]"
                                onPointerDown={(event) =>
                                  event.stopPropagation()
                                }
                                onTouchStart={(event) =>
                                  event.stopPropagation()
                                }
                                onClick={(event) => event.stopPropagation()}
                              >
                                <CommunicationChips
                                  compact
                                  data={buildCommunicationChipDataV17_52(cardOrderForChips)}
                                  onAudioClick={() => openMedia(o)}
                                  onImageClick={() => openMedia(o)}
                                />
                                {callbackBadges.map((badge) =>
                                  renderCallbackCardBadge(cardOrderForChips, badge),
                                )}
                                {messageBadges.map((badge) =>
                                  renderInteractiveOrderCardBadge(badge),
                                )}
                              </div>
                            )}

                            {hasMultipleMergedData && (
                              <span className="mr-1 inline-flex border-r border-slate-200 pr-2 dark:border-slate-700">
                                <MergedContactReviewChip
                                  records={[cardOrderForChips as any]}
                                  compact
                                />
                              </span>
                            )}

                            {operationalBadges.map((badge) =>
                              renderInteractiveOrderCardBadge(badge),
                            )}

                            {otherFooterBadges.map((badge) =>
                              renderInteractiveOrderCardBadge(badge),
                            )}
                          </div>
                        </div>

                        <div className="ml-auto flex w-[120px] shrink-0 flex-col items-end justify-between self-stretch gap-1 pt-0.5 sm:w-[220px] xl:w-[280px]">
                          <div className="flex flex-wrap justify-end gap-1 min-h-[22px]">
                            {orderedRightSideBadges.map((badge) =>
                              renderInteractiveOrderCardBadge(badge, "right"),
                            )}
                          </div>

                          <div className="flex w-full flex-wrap items-end justify-end gap-3">
                            <div className="flex flex-wrap justify-end gap-1">
                              {appointmentBadges.map((badge) =>
                                renderInteractiveOrderCardBadge(badge, "right"),
                              )}
                            </div>

                            <div className="whitespace-nowrap text-right leading-tight">
                              <div className="font-mono font-bold tabular-nums text-[13px] sm:text-sm">
                                {formatCurrency(
                                  getSafeOrderTotal(o),
                                  o.currency === "EUR" ? "EUR" : "CHF",
                                )}
                              </div>
                              {hasOrderVat(o) && (
                                <div className="text-[9px] leading-none text-muted-foreground">
                                  inkl. MwSt
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })
        )}

        {filtered.length > visibleCount && (
          <div className="text-center pt-4">
            <Button
              variant="outline"
              onClick={() => setVisibleCount((v) => v + 30)}
            >
              Mehr laden ({filtered.length - visibleCount} weitere)
            </Button>
          </div>
        )}
      </div>
      <MergeOrdersDialog
        open={mergeStep === 2}
        onOpenChange={(open) => {
          if (!open) handleDialogClose(false);
        }}
        selectedOrders={getSelectedOrders()}
        selectedMainOrderId={selectedMainOrderId}
        onSelectMainOrder={(orderId) => {
          setSelectedMainOrderId(orderId);
          const selectedOrder = orders.find((order) => order.id === orderId);
          setSelectedCustomerId(selectedOrder?.customerId || null);
        }}
        selectedCustomerId={selectedCustomerId}
        onSelectCustomerId={setSelectedCustomerId}
        customers={getUniqueCustomersFromSelected()}
        previewUrls={mergePreviewUrls}
        audioUrls={mergeAudioUrls}
        onRemoveOrder={handleRemoveFromSelection}
        onBack={() => setMergeStep(1)}
        onNext={executeMerge}
        currency={currency}
      />

      {/* Order Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className={`${dupCheckOpen ? "max-w-4xl w-[95vw]" : "max-w-2xl"} max-h-[90vh] overflow-y-auto overflow-x-hidden transition-all [&>button]:hidden`}
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
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              {editId ? "Auftrag bearbeiten" : "Neuer Auftrag"}
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
              {/* Phase 2d: auto-reuse banner (exact / near-exact) */}
              {editId &&
                (() => {
                  const cur = orders.find((o: Order) => o.id === editId);
                  if (!cur) return null;
                  const cust = customers.find(
                    (c: Customer) => c.id === cur.customerId,
                  );
                  const snapshot = cust
                    ? {
                        address: cust.address ?? null,
                        plz: cust.plz ?? null,
                        city: cust.city ?? null,
                      }
                    : null;
                  return (
                    <AutoReuseBanner
                      order={{
                        id: cur.id,
                        reviewReasons: cur.reviewReasons,
                        invoiceId: (cur as any).invoiceId ?? null,
                        offerId: (cur as any).offerId ?? null,
                      }}
                      previousCustomerSnapshot={snapshot}
                      onUndone={async (result) => {
                        // Block A fix: server now restores the pre-suggestion
                        // (intake) address state onto the new split customer
                        // (name + street + city for plz_completed; name + street
                        // + plz for city_completed; all 4 fields for exact reuse).
                        // So the old "Vorherige Adresse" amber hint is no longer
                        // needed — the data is right there in the new customer.
                        setUndoPreviousAddress(null);
                        setForm((f: any) => ({
                          ...f,
                          customerId: result.newCustomerId,
                        }));
                        await load();
                      }}
                    />
                  );
                })()}
              {/* Top header: customer-data warnings — shown near customer area.
                The chip itself is the only click target — clicking it opens
                the customer-edit section. No duplicate buttons here; the
                existing "✏️ Bearbeiten" link inside the customer card and the
                "Kunde aktualisieren" save button inside the edit section
                handle all other actions. */}
              {editId &&
                (() => {
                  const cur = orders.find((o: Order) => o.id === editId);
                  const cust = cur
                    ? customers.find((c: Customer) => c.id === cur.customerId)
                    : null;
                  // Canonical rule — name/address/plz/city required; phone/email optional.

                  const missingData = !!cust && isCustomerDataIncomplete(cust);
                  const hasCustomerReview = !!cur && missingData;
                  const hasImageOnly =
                    cur?.reviewReasons?.includes("image_only_no_text");
                  if (!missingData && !hasImageOnly) return null;

                  return (
                    <div className="flex items-center gap-2 flex-wrap">
                      {(hasCustomerReview || missingData) && (
                        <button
                          type="button"
                          onClick={() => openCustomerEditor()}
                          className="tap-safe inline-flex items-center gap-1.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-md"
                          aria-label="Kundendaten ergänzen — öffnet den Kunde-bearbeiten-Bereich"
                        >
                          {hasCustomerReview && (
                            <Badge
                              variant="secondary"
                              className="text-[11px] px-2 py-0.5 bg-orange-200 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200 border border-orange-300"
                            >
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              Kundendaten prüfen
                            </Badge>
                          )}
                          {!cur?.needsReview && missingData && (
                            <MissingCustomerDataBadge variant="standard" />
                          )}
                        </button>
                      )}
                      {/* Image-only badge in edit dialog */}
                      {hasImageOnly && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300">
                          ⚠️ Bild ohne Text prüfen
                        </span>
                      )}
                      {/* Unit mismatch badge in edit dialog */}
                      {cur?.reviewReasons?.some((r: string) =>
                        r.startsWith("unit_mismatch:"),
                      ) && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300">
                          Einheit prüfen
                        </span>
                      )}
                    </div>
                  );
                })()}
              {/* Customer Info / Select / Edit */}
              <div>
                <div className="mb-1">
                  <Label>Rechnungsadresse *</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Kunde, der die Rechnung bekommt und bezahlt.
                  </p>
                </div>
                {!showNewCustomer ? (
                  <>
                    {/* If editing and customer assigned → show static info, no dropdown */}
                    {editId && form.customerId ? (
                      (() => {
                        const cust = customers.find(
                          (c: Customer) => c.id === form.customerId,
                        );
                        if (!cust) return null;
                        // Required fields: name/address/plz/city — painted red when missing.
                        // Optional fields: phone/email — always neutral (black), never red.
                        const reqMiss = isRequiredCustomerFieldMissing;
                        const visibleCustomerAddress = cust.address;
                        const visibleCustomerPlz = cust.plz;
                        const visibleCustomerCity = cust.city;
                        const canonicalCustomerV2 = getCanonicalIntakeV2(currentEditOrder)?.customer;
                        const strictV2Customer = isIntakeV2Order(currentEditOrder);
                        const visibleCustomerPhone = strictV2Customer
                          ? compactText(canonicalCustomerV2?.phone)
                          : cust.phone || extractOrderContactPhoneForCustomerDisplayV17_90K(currentEditOrder);
                        const visibleCustomerEmail = strictV2Customer
                          ? compactText(canonicalCustomerV2?.email)
                          : cust.email || extractOrderContactEmailForCustomerDisplayV17_90K(currentEditOrder);
                        // Block D: the whole customer card is a shortcut to
                        // "Kunde bearbeiten" (only in edit mode where the card is
                        // static). Keyboard-accessible via Enter/Space. The existing
                        // small "✏️ Bearbeiten" link above still works.
                        return (
                          <>
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => openCustomerEditor()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  openCustomerEditor();
                                }
                              }}
                              title="Kunde bearbeiten"
                              aria-label="Kunde bearbeiten"
                              className="rounded-lg border-2 border-slate-300 bg-slate-50/70 p-2 sm:p-3 dark:border-slate-600 dark:bg-slate-900/30 space-y-1.5 min-w-0 cursor-pointer hover:bg-slate-100/70 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
                            >
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  {/* ISSUE 4 — Show neutral label for fallback customers */}
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
                                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                      <span className="text-sm font-semibold truncate">
                                        👤 {cust.customerNumber || (isUnconfirmedCustomerDraft(cust) ? "Kunde prüfen" : "")}
                                        {cust.customerNumber || isUnconfirmedCustomerDraft(cust) ? " · " : ""}
                                      </span>
                                      <span
                                        className={`text-sm font-semibold truncate ${reqMiss(cust.name) ? "text-red-500 border-b border-red-400 border-dashed pb-0.5 italic" : ""}`}
                                      >
                                        {cust.name || "Name fehlt"}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 sm:justify-end">
                                  <button
                                    type="button"
                                    className="text-xs text-blue-600 hover:underline flex items-center gap-1 whitespace-nowrap"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openCustomerEditor();
                                    }}
                                  >
                                    ✏️ Bearbeiten
                                  </button>
                                  <button
                                    type="button"
                                    className="text-xs text-amber-600 hover:underline flex items-center gap-1 whitespace-nowrap"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setDupCheckOpen(true);
                                    }}
                                  >
                                    🔍 Duplikate prüfen
                                  </button>
                                </div>
                              </div>
                              <div className="grid grid-cols-1 gap-1 text-xs min-w-0">
                                <div
                                  className={`flex items-center gap-1 min-w-0 ${reqMiss(visibleCustomerAddress) ? "text-red-500" : "text-foreground/70"}`}
                                >
                                  <span className="font-medium w-12 sm:w-16 shrink-0">
                                    Strasse:
                                  </span>
                                  <span
                                    className={`truncate ${reqMiss(visibleCustomerAddress) ? "border-b border-red-400 border-dashed pb-0.5 italic" : ""}`}
                                  >
                                    {visibleCustomerAddress || "fehlt"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                  <div
                                    className={`flex items-center gap-1 ${reqMiss(visibleCustomerPlz) ? "text-red-500" : "text-foreground/70"}`}
                                  >
                                    <span className="font-medium w-12 sm:w-16 shrink-0">
                                      PLZ:
                                    </span>
                                    <span
                                      className={
                                        reqMiss(visibleCustomerPlz)
                                          ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                          : ""
                                      }
                                    >
                                      {visibleCustomerPlz || "fehlt"}
                                    </span>
                                  </div>
                                  <div
                                    className={`flex items-center gap-1 ${reqMiss(visibleCustomerCity) ? "text-red-500" : "text-foreground/70"}`}
                                  >
                                    <span className="font-medium shrink-0">
                                      Ort:
                                    </span>
                                    <span
                                      className={
                                        reqMiss(visibleCustomerCity)
                                          ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                          : ""
                                      }
                                    >
                                      {visibleCustomerCity || "fehlt"}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 text-foreground/70">
                                  <span className="font-medium w-12 sm:w-16 shrink-0">
                                    Tel:
                                  </span>
                                  <span className="truncate">
                                    {visibleCustomerPhone || "—"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 text-foreground/70">
                                  <span className="font-medium w-12 sm:w-16 shrink-0">
                                    E-Mail:
                                  </span>
                                  <span className="truncate">
                                    {visibleCustomerEmail || "—"}
                                  </span>
                                </div>
                              </div>
                            </div>
                            {/* PLZ/Ort suggestions are now shown exclusively inside the duplicate panel (§3 UX cleanup) */}
                          </>
                        );
                      })()
                    ) : (
                      /* New order or no customer yet → show dropdown to assign */
                      <>
                        <div className="flex gap-2 min-w-0">
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
                            const cust = customers.find(
                              (c: Customer) => c.id === form.customerId,
                            );
                            if (!cust) return null;
                            const reqMiss = isRequiredCustomerFieldMissing;
                            const visibleCustomerAddress = cust.address;
                            const visibleCustomerPlz = cust.plz;
                            const visibleCustomerCity = cust.city;
                            const canonicalCustomerV2 = getCanonicalIntakeV2(currentEditOrder)?.customer;
                            const strictV2Customer = isIntakeV2Order(currentEditOrder);
                            const visibleCustomerPhone = strictV2Customer
                              ? compactText(canonicalCustomerV2?.phone)
                              : cust.phone || extractOrderContactPhoneForCustomerDisplayV17_90K(currentEditOrder);
                            const visibleCustomerEmail = strictV2Customer
                              ? compactText(canonicalCustomerV2?.email)
                              : cust.email || extractOrderContactEmailForCustomerDisplayV17_90K(currentEditOrder);
                            return (
                              <div className="mt-2 rounded-lg border-2 border-slate-300 bg-slate-50/70 p-2 sm:p-3 dark:border-slate-600 dark:bg-slate-900/30 space-y-1.5 min-w-0">
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    {/* ISSUE 4 — Neutral display for fallback customers */}
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
                                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                        <span className="text-sm font-semibold truncate">
                                          👤 {cust.customerNumber || (isUnconfirmedCustomerDraft(cust) ? "Kunde prüfen" : "")}
                                          {cust.customerNumber || isUnconfirmedCustomerDraft(cust) ? " · " : ""}
                                        </span>
                                        <span
                                          className={`text-sm font-semibold truncate ${reqMiss(cust.name) ? "text-red-500 border-b border-red-400 border-dashed pb-0.5 italic" : ""}`}
                                        >
                                          {cust.name || "Name fehlt"}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 sm:justify-end">
                                    <button
                                      type="button"
                                      className="text-xs text-blue-600 hover:underline flex items-center gap-1 whitespace-nowrap"
                                      onClick={() => openCustomerEditor()}
                                    >
                                      ✏️ Bearbeiten
                                    </button>
                                    <button
                                      type="button"
                                      className="text-xs text-amber-600 hover:underline flex items-center gap-1 whitespace-nowrap"
                                      onClick={() => setDupCheckOpen(true)}
                                    >
                                      🔍 Duplikate prüfen
                                    </button>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 gap-1 text-xs min-w-0">
                                  <div
                                    className={`flex items-center gap-1 min-w-0 ${reqMiss(visibleCustomerAddress) ? "text-red-500" : "text-foreground/70"}`}
                                  >
                                    <span className="font-medium w-12 sm:w-16 shrink-0">
                                      Strasse:
                                    </span>
                                    <span
                                      className={`truncate ${reqMiss(visibleCustomerAddress) ? "border-b border-red-400 border-dashed pb-0.5 italic" : ""}`}
                                    >
                                      {visibleCustomerAddress || "fehlt"}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                    <div
                                      className={`flex items-center gap-1 ${reqMiss(visibleCustomerPlz) ? "text-red-500" : "text-foreground/70"}`}
                                    >
                                      <span className="font-medium w-12 sm:w-16 shrink-0">
                                        PLZ:
                                      </span>
                                      <span
                                        className={
                                          reqMiss(visibleCustomerPlz)
                                            ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                            : ""
                                        }
                                      >
                                        {visibleCustomerPlz || "fehlt"}
                                      </span>
                                    </div>
                                    <div
                                      className={`flex items-center gap-1 ${reqMiss(visibleCustomerCity) ? "text-red-500" : "text-foreground/70"}`}
                                    >
                                      <span className="font-medium shrink-0">
                                        Ort:
                                      </span>
                                      <span
                                        className={
                                          reqMiss(visibleCustomerCity)
                                            ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                            : ""
                                        }
                                      >
                                        {visibleCustomerCity || "fehlt"}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 text-foreground/70">
                                    <span className="font-medium w-12 sm:w-16 shrink-0">
                                      Tel:
                                    </span>
                                    <span className="truncate">
                                      {visibleCustomerPhone || "—"}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 text-foreground/70">
                                    <span className="font-medium w-12 sm:w-16 shrink-0">
                                      E-Mail:
                                    </span>
                                    <span className="truncate">
                                      {visibleCustomerEmail || "—"}
                                    </span>
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
                    className="rounded-lg border-2 border-slate-300 bg-slate-50/70 p-3 space-y-2 dark:border-slate-600 dark:bg-slate-900/30"
                  >
                    <p className="text-xs font-semibold text-muted-foreground">
                      {editingCustomer
                        ? "✏️ Kunde bearbeiten"
                        : "➕ Neuer Kunde erstellen"}
                    </p>
                    {/* Phase 2d (Stage 3): read-only hint line shown after Undo. Lives inside the customer-editor (only when editing) so the Rückgängig context stays close to the address fields. */}
                    {editingCustomer &&
                      editId &&
                      undoPreviousAddress &&
                      (undoPreviousAddress.address ||
                        undoPreviousAddress.plz ||
                        undoPreviousAddress.city) &&
                      (() => {
                        const parts = [
                          undoPreviousAddress.address,
                          [undoPreviousAddress.plz, undoPreviousAddress.city]
                            .filter(Boolean)
                            .join(" "),
                        ]
                          .filter(Boolean)
                          .join(", ");
                        return (
                          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 flex items-start justify-between gap-2">
                            <span>
                              Vorherige Adresse (nur Hinweis, nicht übernommen):{" "}
                              <span className="font-medium">{parts}</span>
                            </span>
                            <button
                              type="button"
                              className="text-amber-700 dark:text-amber-300 hover:underline shrink-0"
                              onClick={() => setUndoPreviousAddress(null)}
                            >
                              schliessen
                            </button>
                          </div>
                        );
                      })()}
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
                        Zurück zum Auftrag
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {shouldShowAddressRoleReviewBoxV17_62 && (
                <div
                  ref={executionAddressRef}
                  tabIndex={-1}
                  className="rounded-lg border-2 border-red-300 bg-red-50/80 p-3 space-y-3 outline-none ring-red-300 focus:ring-2 dark:border-red-800 dark:bg-red-950/20"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-red-800 dark:text-red-200">
                        Ausführungsadresse unklar
                      </div>
                      <p className="text-xs text-red-700/90 dark:text-red-200/80">
                        Bitte Vorschlag bewusst übernehmen, bearbeiten oder verwerfen. Normales Speichern löst diese Prüfung nicht.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-md border border-red-100 bg-white/80 p-2 text-sm dark:border-red-900/50 dark:bg-background/60">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Erkannte Ausführungsadresse
                    </div>
                    {addressRoleReviewCandidateV17_62.sameAsBillingAddress && (
                      <div className="mb-1 inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
                        Gleiche Adresse wie Rechnungsadresse
                      </div>
                    )}
                    {addressRoleReviewCandidateV17_62.hasAny ? (
                      <>
                        {addressRoleReviewCandidateV17_62.siteName && (
                          <div className="font-medium">
                            {addressRoleReviewCandidateV17_62.siteName}
                          </div>
                        )}
                        <div>
                          {addressRoleReviewCandidateV17_62.siteAddress ||
                            "Strasse fehlt"}
                        </div>
                        <div>
                          {[
                            addressRoleReviewCandidateV17_62.sitePlz,
                            addressRoleReviewCandidateV17_62.siteCity,
                          ]
                            .filter(Boolean)
                            .join(" ") || "PLZ / Ort fehlt"}
                        </div>
                        {addressRoleReviewCandidateV17_62.siteNote && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {addressRoleReviewCandidateV17_62.siteNote}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-sm text-red-700 dark:text-red-200">
                        Kein vollständiger Vorschlag erkannt. Bitte Ausführungsadresse manuell eintragen oder den Hinweis verwerfen.
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    {!hasLinkedExistingBillingCustomerV17_90L36 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={applyAddressReviewAsBillingV17_62}
                        className="justify-center border-red-200 bg-white text-red-800 hover:bg-red-50 dark:bg-background dark:text-red-100"
                      >
                        Als Rechnungsadresse speichern
                      </Button>
                    ) : (
                      <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200">
                        Bestehender Kunde
                        {currentBillingCustomerV17_90L36?.customerNumber
                          ? ` ${currentBillingCustomerV17_90L36.customerNumber}`
                          : ""}{" "}
                        ist bereits zugeordnet. Rechnungsadresse nur über
                        „Kunde bearbeiten“ ändern.
                      </div>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      onClick={applyAddressReviewAsExecutionV17_62}
                      className="justify-center"
                    >
                      Übernehmen
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={editAddressReviewSuggestionV17_90L94}
                      className="justify-center"
                    >
                      Bearbeiten
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={discardAddressReviewSuggestionV17_90L36D}
                      disabled={saving}
                      className="justify-center"
                    >
                      Verwerfen
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Bei manueller Bearbeitung wird die Prüfung erst durch „Ausführungsort speichern“ gelöst.
                  </p>
                </div>
              )}

              {/* Ausführungsadresse / Baustellenadresse.
                  Bei mehreren Arbeitsorten ist der bearbeitbare Block darunter die einzige Wahrheit. */}
              {!hasMultipleEditWorkSites && (
                <div
                  ref={!shouldShowAddressRoleReviewBoxV17_62 ? executionAddressRef : undefined}
                  tabIndex={-1}
                  className="rounded-xl border-2 border-cyan-300 bg-cyan-50/40 p-2.5 space-y-2.5 outline-none ring-cyan-300 focus:ring-2 dark:border-cyan-800 dark:bg-cyan-950/20"
                >
                  <div
                    role={form.siteAddressDifferent ? "button" : undefined}
                    tabIndex={form.siteAddressDifferent ? 0 : -1}
                    onClick={(event) => {
                      const target = event.target as HTMLElement;
                      if (target.closest("button,input,select,textarea,a")) return;
                      toggleOrderExecutionAddressEditor();
                    }}
                    onKeyDown={(event) => {
                      if (
                        form.siteAddressDifferent &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        toggleOrderExecutionAddressEditor();
                      }
                    }}
                    className={`-m-1 grid grid-cols-1 gap-2 rounded-lg p-1.5 outline-none transition-colors sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start ${
                      form.siteAddressDifferent
                        ? "cursor-pointer hover:bg-cyan-100/80 focus-visible:ring-2 focus-visible:ring-cyan-400 dark:hover:bg-cyan-900/30"
                        : ""
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(form.siteAddressDifferent)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(e) =>
                          setOrderExecutionAddressEnabledV17_90L288(
                            e.target.checked,
                          )
                        }
                        className="mt-1"
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
                    {form.siteAddressDifferent && !siteAddressEditing && (
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 w-full justify-start px-2 text-xs sm:w-auto"
                          onClick={addFormWorkSite}
                          disabled={saving}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          Ausführungsort
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 w-full justify-start px-2 text-xs sm:w-auto"
                          onClick={() => setSiteAddressEditing(true)}
                          disabled={saving}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          Bearbeiten
                        </Button>
                      </div>
                    )}
                  </div>

                  {form.siteAddressDifferent && !siteAddressEditing && (
                    <button
                      type="button"
                      onClick={toggleOrderExecutionAddressEditor}
                      className="w-full rounded-lg border bg-background p-3 text-left transition-colors hover:bg-cyan-50/80 dark:hover:bg-cyan-950/30"
                      title="Ausführungsadresse bearbeiten"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">
                            📍 {cleanWorkSiteDisplayName(form.siteName) || "Ausführungsadresse"}
                          </div>
                          <div className="mt-1 grid grid-cols-[74px_1fr] gap-x-2 gap-y-0.5 text-sm">
                            <span className="text-muted-foreground">
                              Strasse:
                            </span>
                            <span className="truncate">
                              {form.siteAddress?.trim() || "–"}
                            </span>
                            <span className="text-muted-foreground">
                              PLZ / Ort:
                            </span>
                            <span className="truncate">
                              {[form.sitePlz, form.siteCity]
                                .filter(Boolean)
                                .join(" ") || "–"}
                            </span>
                            {form.siteNote?.trim() && (
                              <>
                                <span className="text-muted-foreground">
                                  Hinweis:
                                </span>
                                <span className="truncate">
                                  {form.siteNote}
                                </span>
                              </>
                            )}
                          </div>
                          {showFirstTimeExecutionAddressSavedNoticeV17_73 && (
                            <div className="mt-2 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                              ✅ Im Kundenprofil gespeichert
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  )}

                  {form.siteAddressDifferent && siteAddressEditing && (
                    <div className="rounded-lg border bg-background p-3 space-y-3">
                      <div>
                        <div className="text-sm font-semibold">
                          Ausführungsadresse / Baustellenadresse
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Gilt nur für diesen Auftrag. Wird später in Angebot,
                          Rechnung und PDF separat angezeigt.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {renderOrderExecutionAddressAutocompleteV17_90L291({
                          inputKey: "primary-order-site",
                          value: form.siteName,
                          onChange: (value) =>
                            setForm((current) => ({
                              ...current,
                              siteName: value,
                            })),
                          onSelect:
                            applyPersistentExecutionAddressSuggestionV17_68,
                          placeholder: "z. B. Baustelle Tiefgarage",
                        })}
                        <div>
                          <Label className="text-xs">Strasse + Hausnr.</Label>
                          <Input
                            placeholder="Strasse + Hausnr."
                            value={form.siteAddress}
                            onChange={(e) =>
                              setForm({ ...form, siteAddress: e.target.value })
                            }
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-[130px_1fr] gap-2">
                        <div>
                          <Label className="text-xs">PLZ</Label>
                          <Input
                            placeholder="PLZ"
                            value={form.sitePlz}
                            onChange={(e) =>
                              setForm({ ...form, sitePlz: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Ort</Label>
                          <Input
                            placeholder="Ort"
                            value={form.siteCity}
                            onChange={(e) =>
                              setForm({ ...form, siteCity: e.target.value })
                            }
                          />
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs">Zusatz / Hinweis</Label>
                        <Input
                          placeholder="z. B. Eingang hinten, Tor 2, Hauswart vor Ort"
                          value={form.siteNote}
                          onChange={(e) =>
                            setForm({ ...form, siteNote: e.target.value })
                          }
                        />
                      </div>

                      {renderCustomerExecutionAddressSaveChoiceV17_90L296({
                        ...(formWorkSites.find((entry) => entry.isPrimary) || formWorkSites[0] || {}),
                        siteName: form.siteName,
                        siteAddress: form.siteAddress,
                        sitePlz: form.sitePlz,
                        siteCity: form.siteCity,
                        siteNote: form.siteNote,
                      } as OrderWorkSite)}

                      <div className="flex flex-wrap items-center justify-between gap-3">
                        {shouldShowCustomerExecutionAddressSaveCheckboxV17_90L298(({ ...(formWorkSites.find((entry) => entry.isPrimary) || formWorkSites[0] || {}), siteName: form.siteName, siteAddress: form.siteAddress, sitePlz: form.sitePlz, siteCity: form.siteCity, siteNote: form.siteNote } as OrderWorkSite)) && (
                        <label className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-input"
                            checked={saveExecutionAddressInCustomerProfile}
                            onChange={(event) =>
                              setSaveExecutionAddressInCustomerProfile(
                                event.target.checked,
                              )
                            }
                          />
                          Im Kundenprofil speichern
                        </label>
                        )}
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={addFormWorkSite}
                            disabled={saving}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            Ausführungsort
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={saveExecutionAddressFromEditorV17_70}
                            disabled={saving}
                          >
                            {saving
                              ? "Übernehmen..."
                              : "Ausführungsort übernehmen"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Service Items + rest of form — collapsed when dupCheck open */}
              {dupCheckOpen ? (
                <div className="p-2 bg-muted/40 rounded border border-dashed text-xs text-muted-foreground flex items-center justify-between">
                  <span>
                    {formItems.filter((i) => i.serviceName).length} Leistung(en)
                    · {formatCurrency(itemsTotal, currency)} ·{" "}
                    {form.date || "–"} · {form.status}
                  </span>
                  <span className="text-[10px] italic">
                    Duplikat-Prüfung aktiv — Form eingeklappt
                  </span>
                </div>
              ) : (
                <>
                  <div
                    ref={serviceItemsRef}
                    tabIndex={-1}
                    className="scroll-mt-24 rounded-xl border-2 border-slate-300 bg-background p-2.5 sm:p-3 space-y-2 outline-none focus:ring-2 focus:ring-amber-300/60 dark:border-slate-600"
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <Label className="whitespace-nowrap text-base font-semibold">
                            {hasMultipleEditWorkSites
                              ? "Arbeitsorte & Leistungen"
                              : `Leistungen · ${formItems.filter((item) => item.serviceName.trim()).length} *`}
                          </Label>
                          {currentEditMergedHeaderBadge &&
                            currentEditExecutionHeaderBadge &&
                            renderOrderCardBadge(
                              currentEditExecutionHeaderBadge,
                              "left",
                            )}
                          {currentEditMergedHeaderBadge &&
                            renderOrderCardBadge(
                              currentEditMergedHeaderBadge,
                              "left",
                            )}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {hasMultipleEditWorkSites && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={toggleWorkSiteOverview}
                              className="h-7 px-2 text-xs"
                            >
                              {allEditWorkSiteGroupsExpandedV17_90L290
                                ? "Übersicht"
                                : "Alle öffnen"}
                            </Button>
                          )}
                          {hasMultipleEditWorkSites && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={addFormWorkSite}
                              disabled={saving}
                              className="h-7 shrink-0 px-2 text-xs"
                            >
                              <Plus className="mr-1 h-3.5 w-3.5" />
                              Ausführungsort
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
                            Leistung
                          </Button>
                        </div>
                      </div>
                      {hasMultipleEditWorkSites ? (
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span className="min-w-0 truncate">
                            {currentEditWorkSites.length} Arbeitsorte · {formItems.filter((item) => item.serviceName.trim()).length} Leistungen
                          </span>
                          <span className="shrink-0 font-mono font-medium text-foreground">
                            {formatCurrency(itemsTotal, currency)}
                          </span>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Kompakte Übersicht. Zum Bearbeiten die Leistung aufklappen.
                        </p>
                      )}
                    </div>

                    {hasCurrentRecognitionReviewV17_90L69 && (
                      <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200">
                        <div className="font-semibold">⚠ Erkennung prüfen</div>
                        {currentRecognitionReviewDetailsV17_90L69.length > 0 ? (
                          <div className="mt-2 space-y-2">
                            {currentRecognitionReviewDetailsV17_90L69
                              .slice(0, 8)
                              .map((detail, index) => (
                                <div
                                  key={`${recognitionReviewDetailKeyV17_90L70(detail)}-${index}`}
                                  className="rounded-md border border-red-200 bg-white/85 p-2 dark:border-red-900/60 dark:bg-background/50"
                                >
                                  <div className="font-semibold leading-snug">
                                    {formatRecognitionReviewLineV17_90L69(detail).replace(/^•\s*/, "")}
                                  </div>
                                  {detail.kind === "missing_work" &&
                                    recognitionReviewHasSeparateDisplayTextV17_90L253(
                                      detail,
                                    ) && (
                                      <div className="mt-1 text-[11px] font-bold leading-snug text-red-900 dark:text-red-100">
                                        {compactRecognitionReviewSourceV17_90L262(
                                          recognitionReviewTakeoverTextV17_90L253(detail),
                                          108,
                                        )}
                                      </div>
                                    )}
                                  {compactText(detail.sourceText) && (
                                    <div className="mt-1 text-[11px] font-semibold leading-snug text-red-800 dark:text-red-100">
                                      <span className="font-bold">Quelle:</span>{" "}
                                      <span className="font-bold">
                                        {compactRecognitionReviewSourceV17_90L262(
                                          detail.sourceText,
                                        )}
                                      </span>
                                    </div>
                                  )}
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="h-7 px-2 text-xs"
                                      onClick={() =>
                                        takeOverRecognitionReviewDetailV17_90L70(
                                          detail,
                                        )
                                      }
                                    >
                                      Übernehmen
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-7 border-red-300 bg-white px-2 text-xs text-red-800 hover:bg-red-50 dark:bg-background dark:text-red-100"
                                      onClick={() =>
                                        discardRecognitionReviewDetailV17_90L70(
                                          detail,
                                        )
                                      }
                                    >
                                      Verwerfen
                                    </Button>
                                  </div>
                                </div>
                              ))}
                          </div>
                        ) : (
                          <div className="mt-2 rounded-md border border-red-200 bg-white/85 p-2 dark:border-red-900/60 dark:bg-background/50">
                            <div className="font-medium">
                              Mögliche fehlende oder falsch zugeordnete Leistung.
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="mt-2 h-7 border-red-300 bg-white px-2 text-xs text-red-800 hover:bg-red-50 dark:bg-background dark:text-red-100"
                              onClick={() =>
                                discardRecognitionReviewDetailV17_90L70(null)
                              }
                            >
                              Verwerfen
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="space-y-2">
                      {formItemDisplayRows.map(
                        ({
                          item,
                          index,
                          site,
                          isFirstInSite,
                          isEmptySitePlaceholder,
                        }) => {
                          const curOrder = editId
                            ? orders.find((o: Order) => o.id === editId)
                            : null;

                          const unitMismatchReason = curOrder?.reviewReasons
                            ?.filter((r: string) =>
                              r.startsWith("unit_mismatch:"),
                            )
                            .find((r: string) => {
                              const [, serviceName] = r.split(":");
                              const sameService =
                                (serviceName || "").trim().toLowerCase() ===
                                (item.serviceName || "").trim().toLowerCase();
                              if (!sameService) return false;

                              const sourceEvidence = [
                                (item as any).sourceText,
                                (item as any).evidence,
                                item.aiWarning,
                                item.serviceName,
                              ]
                                .filter(Boolean)
                                .join(" ");
                              return !recognitionEvidenceMentionsUnitV17_90L80(
                                sourceEvidence,
                                item.unit,
                              );
                            });

                          const unitMissingInTextReason =
                            findUnitMissingInTextReviewForService(
                              curOrder?.reviewReasons,
                              item.serviceName,
                            );
                          const manualUnitConfirmed = Boolean(
                            item.manualUnitConfirmed,
                          );
                          const manualReviewConfirmedV17_90L241 = Boolean(
                            item.manualReviewConfirmed,
                          );
                          const hasPendingManualReviewDecisionV17_90L247 = Boolean(
                            item.pendingManualReviewDecision &&
                              !manualReviewConfirmedV17_90L241,
                          );
                          const persistedOrderItemForReviewV17_90L243 =
                            curOrder?.items?.find((storedItem) => {
                              const sameService = reviewServiceNamesMatchV17_90L241(
                                storedItem.serviceName,
                                item.serviceName,
                              );
                              if (!sameService) return false;
                              if (!item.workSiteId) return true;
                              return storedItem.workSiteId === item.workSiteId;
                            }) || null;
                          const persistedReviewTextV17_90L243 = normalizeForMatch(
                            [
                              persistedOrderItemForReviewV17_90L243?.reviewReason,
                              persistedOrderItemForReviewV17_90L243?.description,
                            ]
                              .filter(Boolean)
                              .join(" "),
                          );
                          const hasPersistedBlockingItemReviewV17_90L243 = Boolean(
                            !manualReviewConfirmedV17_90L241 &&
                              (hasPendingManualReviewDecisionV17_90L247 ||
                                (persistedOrderItemForReviewV17_90L243 &&
                              (isInternalReviewServiceName(
                                persistedOrderItemForReviewV17_90L243.serviceName,
                              ) ||
                                isUnitMissingReviewText(
                                  persistedOrderItemForReviewV17_90L243.unit,
                                ) ||
                                Number(
                                  persistedOrderItemForReviewV17_90L243.quantity || 0,
                                ) <= 0 ||
                                Number(
                                  persistedOrderItemForReviewV17_90L243.unitPrice || 0,
                                ) <= 0 ||
                                /(?:price|preis|quantity|menge|unit|einheit|currency|waehrung|wahrung|canonical|mutation).*(?:review|pruef|pruf|unclear|missing|blocked|widerspruch|conflict)/i.test(
                                  persistedReviewTextV17_90L243,
                                )))),
                          );
                          const canonicalMutationReviewReasonV17_90L241 =
                            findCanonicalMutationReviewForServiceV17_90L241(
                              curOrder?.reviewReasons,
                              item.serviceName,
                            );
                          const hasExplicitBlockingReviewV17_90L241 = Boolean(
                            (unitMissingInTextReason ||
                              canonicalMutationReviewReasonV17_90L241) &&
                              !manualReviewConfirmedV17_90L241,
                          );

                          const priceOverrideReason = curOrder?.reviewReasons
                            ?.filter((r: string) =>
                              r.startsWith("price_override:"),
                            )
                            .find((r: string) => {
                              const [, serviceName] = r.split(":");
                              return (
                                normalizeForMatch(serviceName) ===
                                normalizeForMatch(item.serviceName)
                              );
                            });

                          const priceUnclearReason = curOrder?.reviewReasons
                            ?.filter((r: string) =>
                              r.startsWith("price_unclear:"),
                            )
                            .find((r: string) => {
                              const reasonService = String(r || "")
                                .split(":")
                                .slice(1)
                                .join(":");
                              if (!reasonService) {
                                return Boolean(
                                  persistedOrderItemForReviewV17_90L243 &&
                                    Number(
                                      persistedOrderItemForReviewV17_90L243.unitPrice || 0,
                                    ) <= 0,
                                );
                              }
                              return reviewServiceNamesMatchV17_90L241(
                                reasonService,
                                item.serviceName,
                              );
                            });
                          const priceContradictionReasonV17_90L234 =
                            findPriceContradictionReviewForServiceV17_90L234(
                              curOrder?.reviewReasons,
                              item.serviceName,
                            );
                          const hasPendingPriceUnclearReviewV17_90L245 = Boolean(
                            priceUnclearReason &&
                              !manualReviewConfirmedV17_90L241,
                          );
                          const showPriceContradictionReviewV17_90L234 = Boolean(
                            priceContradictionReasonV17_90L234 &&
                              !item.manualCurrencyConfirmed &&
                              !hasPendingPriceUnclearReviewV17_90L245,
                          );

                          const catalogService = findCatalogServiceForName(
                            services,
                            item.serviceName,
                          );
                          const catalogPrice = Number(
                            catalogService?.defaultPrice || 0,
                          );
                          const itemPriceNumber = Number(item.unitPrice || 0);
                          const hasFrontendCatalogPriceDeviation =
                            Boolean(catalogService) &&
                            !item.catalogReviewConfirmed &&
                            !unitMismatchReason &&
                            normalizePriceUnitForCompare(
                              catalogService?.unit,
                            ) === normalizePriceUnitForCompare(item.unit) &&
                            Number.isFinite(catalogPrice) &&
                            Number.isFinite(itemPriceNumber) &&
                            catalogPrice > 0 &&
                            itemPriceNumber > 0 &&
                            Math.abs(catalogPrice - itemPriceNumber) >= 0.01;
                          const hasFrontendCatalogTextFlatOverride =
                            Boolean(catalogService) &&
                            !item.catalogReviewConfirmed &&
                            !unitMismatchReason &&
                            normalizePriceUnitForCompare(
                              catalogService?.unit,
                            ) !== normalizePriceUnitForCompare(item.unit) &&
                            normalizePriceUnitForCompare(item.unit) ===
                              "flat" &&
                            Number.isFinite(itemPriceNumber) &&
                            itemPriceNumber > 0 &&
                            Number(item.quantity || 0) === 1;
                          const hasFrontendCatalogUnitDeviation =
                            Boolean(catalogService) &&
                            !item.catalogReviewConfirmed &&
                            !unitMismatchReason &&
                            normalizePriceUnitForCompare(
                              catalogService?.unit,
                            ) !== normalizePriceUnitForCompare(item.unit) &&
                            normalizePriceUnitForCompare(item.unit) !== "flat";

                          const hasCurrencyConflict = hasEditCurrencyReview;
                          // V17.22: Rot ist pro Position, nicht global. Eine
                          // CHF-Zeile im EUR-Auftrag bleibt rot/0. Eine EUR-Zeile
                          // im EUR-Auftrag bleibt berechenbar und wird bei
                          // Katalogabweichung gelb markiert.
                          const unresolvedCurrencyItem =
                            isFormItemBlockedByCurrencyReview(item);
                          const showCurrencyConflictItemReview =
                            unresolvedCurrencyItem;
                          const priceInputReview =
                            unresolvedCurrencyItem ||
                            Number(item.unitPrice || 0) === 0;
                          const quantityInputReview =
                            Number(item.quantity || 0) === 0;
                          const priceInputCritical = priceInputReview;
                          const quantityInputCritical = quantityInputReview;
                          const showUnitConflict =
                            !unresolvedCurrencyItem &&
                            Boolean(
                              item.aiWarning?.trim() ||
                              unitMismatchReason ||
                              unitMissingInTextReason ||
                              canonicalMutationReviewReasonV17_90L241 ||
                              manualUnitConfirmed ||
                              manualReviewConfirmedV17_90L241,
                            );
                          const showPriceOverride =
                            !unresolvedCurrencyItem &&
                            !showUnitConflict &&
                            Boolean(
                              (!item.catalogReviewConfirmed &&
                                priceOverrideReason) ||
                              hasFrontendCatalogPriceDeviation ||
                              hasFrontendCatalogTextFlatOverride ||
                              hasFrontendCatalogUnitDeviation,
                            );
                          // V17.90L81: A global unit_price_review must not
                          // paint every otherwise complete manual service with
                          // "Preis im Text unklar". Only an item-specific reason
                          // may show that message.
                          const showPriceReferenceReview =
                            !unresolvedCurrencyItem &&
                            !priceInputReview &&
                            Boolean(
                              priceUnclearReason &&
                                isServiceInCatalog(item.serviceName),
                            );
                          const showManualCurrencyConfirmedReview =
                            !unresolvedCurrencyItem &&
                            Boolean(item.manualCurrencyConfirmed);

                          const itemTotal =
                            hasPersistedBlockingItemReviewV17_90L243 ||
                            hasExplicitBlockingReviewV17_90L241 ||
                            hasPendingPriceUnclearReviewV17_90L245 ||
                            (unitMissingInTextReason && !manualUnitConfirmed)
                              ? 0
                              : getSafeFormItemTotal(item);
                          const itemHasInternalReviewServiceName =
                            isInternalReviewServiceName(item.serviceName);
                          const itemHasInternalReviewUnit =
                            isUnitMissingReviewText(item.unit);
                          const unitInputCriticalV17_90L243 = Boolean(
                            itemHasInternalReviewUnit ||
                              (unitMissingInTextReason && !manualUnitConfirmed),
                          );
                          const blockingReviewFieldsV17_90L243 = Array.from(
                            new Set(
                              [
                                itemHasInternalReviewServiceName ||
                                /leistung\s+(?:oder\s+einheit\s+)?(?:unklar|offen|pr[üu]fen)|service[_\s-]*(?:unclear|review)/i.test(
                                  [item.aiWarning, item.sourceDescription, item.serviceName]
                                    .filter(Boolean)
                                    .join(" "),
                                )
                                  ? "Leistung"
                                  : "",
                                unitInputCriticalV17_90L243 ||
                                /einheit\s+(?:fehlt|offen|unklar|pr[üu]fen)|unit\s+(?:missing|open|unknown|unclear|review)/i.test(
                                  [item.aiWarning, item.sourceDescription, item.serviceName]
                                    .filter(Boolean)
                                    .join(" "),
                                )
                                  ? "Einheit"
                                  : "",
                                quantityInputReview ? "Menge" : "",
                                (priceInputReview ||
                                  hasPendingPriceUnclearReviewV17_90L245) &&
                                !unresolvedCurrencyItem
                                  ? "Preis"
                                  : "",
                              ].filter(Boolean),
                            ),
                          );
                          const blockingReviewFieldListV17_90L243 =
                            blockingReviewFieldsV17_90L243.length <= 1
                              ? blockingReviewFieldsV17_90L243[0] || ""
                              : blockingReviewFieldsV17_90L243.length === 2
                                ? blockingReviewFieldsV17_90L243.join(" und ")
                                : `${blockingReviewFieldsV17_90L243
                                    .slice(0, -1)
                                    .join(", ")} und ${blockingReviewFieldsV17_90L243.at(-1)}`;
                          const blockingReviewBadgeLabelV17_90L243 =
                            blockingReviewFieldListV17_90L243
                              ? `${blockingReviewFieldListV17_90L243} prüfen`
                              : "";
                          const itemQuantityUnitSummaryV17_90L243 =
                            quantityInputReview && unitInputCriticalV17_90L243
                              ? "Einheit und Menge prüfen"
                              : quantityInputReview
                                ? `Menge prüfen ${unitShortLabel(item.unit)}`.trim()
                                : unitInputCriticalV17_90L243
                                  ? `${item.quantity || "–"} · Einheit prüfen`
                                  : `${item.quantity} ${unitShortLabel(item.unit)}`.trim();
                          const isCompleteItemForCatalogAction = Boolean(
                            item.serviceName?.trim() &&
                            !itemHasInternalReviewServiceName &&
                            item.unit?.trim() &&
                            !itemHasInternalReviewUnit &&
                            Number(item.unitPrice || 0) > 0 &&
                            Number(item.quantity || 0) > 0,
                          );

                          const isManualService =
                            Boolean(item.serviceName?.trim()) &&
                            !isInternalReviewServiceName(item.serviceName) &&
                            !isServiceInCatalog(item.serviceName);
                          const showManualServiceReview =
                            !unresolvedCurrencyItem && isManualService;
                          const hasInternalHardReviewState =
                            itemHasInternalReviewServiceName ||
                            (itemHasInternalReviewUnit && !manualUnitConfirmed);
                          const itemEvidenceInput = {
                            quantity: item.quantity,
                            unit: item.unit,
                            unitPrice: item.unitPrice,
                          };
                          const sourceLineForItem =
                            getCompactStoredItemEvidenceV17_90L81(
                              item.sourceDescription,
                              item.serviceName,
                              itemEvidenceInput,
                            ) ||
                            findCustomerTextLineForService(
                              visibleCustomerMessageText || customerMessageText,
                              item.serviceName,
                              itemEvidenceInput,
                            );
                          const catalogSummary = catalogService
                            ? `${catalogService.unit}${
                                catalogPrice > 0
                                  ? ` · ${formatCurrency(catalogPrice, currency)}`
                                  : ""
                              }`
                            : "";
                          const orderSummaryParts = [
                            Number(item.quantity || 0) > 0
                              ? `${item.quantity} ${unitShortLabel(item.unit)}`
                              : unitShortLabel(item.unit),
                            itemPriceNumber > 0
                              ? `à ${formatCurrency(itemPriceNumber, currency)}`
                              : "Preis prüfen",
                          ].filter(Boolean);
                          const orderSummary = orderSummaryParts.join(" ");
                          const showItemReviewBlock =
                            showCurrencyConflictItemReview ||
                            hasPersistedBlockingItemReviewV17_90L243 ||
                            hasInternalHardReviewState ||
                            hasPendingPriceUnclearReviewV17_90L245 ||
                            showPriceContradictionReviewV17_90L234 ||
                            (!unresolvedCurrencyItem &&
                              (showUnitConflict ||
                                showPriceOverride ||
                                showPriceReferenceReview ||
                                showManualCurrencyConfirmedReview ||
                                priceInputReview ||
                                quantityInputReview ||
                                showManualServiceReview));
                          const hasMissingItemInput =
                            priceInputReview || quantityInputReview;
                          const isBlockingItemReview =
                            unresolvedCurrencyItem ||
                            hasPersistedBlockingItemReviewV17_90L243 ||
                            hasInternalHardReviewState ||
                            hasPendingPriceUnclearReviewV17_90L245 ||
                            showPriceContradictionReviewV17_90L234 ||
                            hasMissingItemInput ||
                            hasExplicitBlockingReviewV17_90L241 ||
                            Boolean(unitMissingInTextReason && !manualUnitConfirmed) ||
                            (showPriceReferenceReview &&
                              !isCompleteItemForCatalogAction) ||
                            (showUnitConflict &&
                              !isCompleteItemForCatalogAction);
                          const compactBlockingReviewFieldsV17_90L242 =
                            blockingReviewFieldsV17_90L243;
                          const compactBlockingFieldListV17_90L242 =
                            blockingReviewFieldListV17_90L243;
                          const compactBlockingReviewMessageV17_90L242 =
                            unresolvedCurrencyItem
                              ? "Währung und Preis müssen bestätigt werden."
                              : hasPendingPriceUnclearReviewV17_90L245
                                ? itemPriceNumber > 0
                                  ? `Preis ${formatCurrency(itemPriceNumber, currency)} muss bestätigt werden.`
                                  : "Preis ist unklar."
                              : showPriceContradictionReviewV17_90L234
                                ? "Gesamt-/Pauschalpreis und Preis je Einheit widersprechen sich."
                                : compactBlockingFieldListV17_90L242
                                  ? `${compactBlockingFieldListV17_90L242} ${
                                      compactBlockingReviewFieldsV17_90L242.length === 1
                                        ? "ist"
                                        : "sind"
                                    } unklar.${
                                      itemPriceNumber > 0 &&
                                      !compactBlockingReviewFieldsV17_90L242.includes("Preis")
                                        ? ` Preis ${formatCurrency(itemPriceNumber, currency)} erkannt.`
                                        : ""
                                    }`
                                  : canonicalMutationReviewReasonV17_90L241
                                    ? "Aktuelle Angaben aus dem letzten sicheren Stand prüfen."
                                    : "Angaben prüfen und bestätigen.";
                          const compactBlockingReviewSourceV17_90L242 = (() => {
                            const value = String(sourceLineForItem || "")
                              .replace(/\s+/g, " ")
                              .trim();
                            if (!value) return "";
                            return value.length > 150
                              ? `${value.slice(0, 147).trim()}…`
                              : value;
                          })();
                          const isMenuOpen = serviceActionMenuKey === item.key;
                          const hasCriticalItemReview = isBlockingItemReview;
                          const hasResolvedReviewCatalogAction =
                            isCompleteItemForCatalogAction &&
                            Boolean(
                              showCurrencyConflictItemReview ||
                              unitMismatchReason ||
                              unitMissingInTextReason ||
                              canonicalMutationReviewReasonV17_90L241 ||
                              item.aiWarning?.trim() ||
                              priceUnclearReason ||
                              priceContradictionReasonV17_90L234 ||
                              curOrder?.reviewReasons?.includes(
                                "unit_price_review",
                              ),
                            );
                          const existingCatalogUnitMismatch = Boolean(
                            catalogService &&
                            normalizePriceUnitForCompare(
                              catalogService.unit,
                            ) !== normalizePriceUnitForCompare(item.unit),
                          );
                          const existingCatalogPriceMismatch = Boolean(
                            catalogService &&
                            Number.isFinite(catalogPrice) &&
                            Number.isFinite(itemPriceNumber) &&
                            catalogPrice > 0 &&
                            itemPriceNumber > 0 &&
                            Math.abs(catalogPrice - itemPriceNumber) >= 0.01,
                          );
                          const hasCatalogActionMenu =
                            isCompleteItemForCatalogAction &&
                            !isInternalReviewServiceName(item.serviceName) &&
                            !priceInputReview &&
                            !quantityInputReview &&
                            (showManualServiceReview ||
                              showPriceOverride ||
                              existingCatalogUnitMismatch ||
                              existingCatalogPriceMismatch ||
                              hasResolvedReviewCatalogAction);
                          const hasAnyItemReview =
                            hasCriticalItemReview ||
                            showPriceContradictionReviewV17_90L234 ||
                            showPriceOverride ||
                            showManualCurrencyConfirmedReview ||
                            showManualServiceReview ||
                            hasResolvedReviewCatalogAction;
                          const itemReviewReasonV17_90L134 =
                            (unresolvedCurrencyItem
                              ? "Währung prüfen"
                              : hasPendingPriceUnclearReviewV17_90L245
                                ? "Preis prüfen"
                              : showPriceContradictionReviewV17_90L234
                                ? "Preiswiderspruch"
                                : blockingReviewBadgeLabelV17_90L243 ||
                                  (hasPersistedBlockingItemReviewV17_90L243
                                    ? "Angaben prüfen"
                                    : "")) ||
                            getOrderServiceReviewReasonV17_90L134(
                              item,
                              services || [],
                            ) ||
                            (hasAnyItemReview ? "Manuell prüfen" : "");
                          const siteIndex = site
                            ? currentEditWorkSites.findIndex(
                                (option) => option.id === site.id,
                              )
                            : -1;
                          const isActiveSite = Boolean(
                            site && activeWorkSiteId === site.id,
                          );
                          const groupItems = getWorkSiteGroupItems(site);
                          const groupItemCount = groupItems.length;
                          const groupReviewSummaryV17_90L135G =
                            buildOrderStructuredServiceReviewV17_90L135G(
                              groupItems,
                              services || [],
                              currency,
                              true,
                            );
                          const groupReviewBadges = (() => {
                            const badges: ReviewBadge[] = [];
                            const addBadge = (
                              key: string,
                              label: string,
                              className: string,
                              tooltip?: string,
                            ) => {
                              if (!badges.some((badge) => badge.key === key)) {
                                badges.push({ key, label, className, tooltip });
                              }
                            };

                            for (const groupItem of groupItems) {
                              const itemName = groupItem.serviceName || "";
                              const itemKey = normalizeForMatch(itemName);
                              const groupCatalogService =
                                findCatalogServiceForName(services, itemName);
                              const groupCatalogPrice = Number(
                                groupCatalogService?.defaultPrice || 0,
                              );
                              const groupItemPrice = Number(
                                groupItem.unitPrice || 0,
                              );
                              const groupItemQuantity = Number(
                                groupItem.quantity || 0,
                              );
                              const groupUnitMismatchReason =
                                curOrder?.reviewReasons
                                  ?.filter((reason: string) =>
                                    reason.startsWith("unit_mismatch:"),
                                  )
                                  .find((reason: string) => {
                                    const [, serviceName] = reason.split(":");
                                    return (
                                      normalizeForMatch(serviceName) === itemKey
                                    );
                                  });
                              const groupPriceOverrideReason =
                                curOrder?.reviewReasons
                                  ?.filter((reason: string) =>
                                    reason.startsWith("price_override:"),
                                  )
                                  .find((reason: string) => {
                                    const [, serviceName] = reason.split(":");
                                    return (
                                      normalizeForMatch(serviceName) === itemKey
                                    );
                                  });
                              const groupPriceUnclearReason =
                                curOrder?.reviewReasons
                                  ?.filter((reason: string) =>
                                    reason.startsWith("price_unclear:"),
                                  )
                                  .find((reason: string) => {
                                    const [, serviceName] = reason.split(":");
                                    return (
                                      !serviceName ||
                                      normalizeForMatch(serviceName) === itemKey
                                    );
                                  });
                              const groupPriceContradictionReasonV17_90L234 =
                                findPriceContradictionReviewForServiceV17_90L234(
                                  curOrder?.reviewReasons,
                                  itemName,
                                );
                              const groupPriceContradictionOpenV17_90L234 =
                                Boolean(
                                  groupPriceContradictionReasonV17_90L234 &&
                                    !groupItem.manualCurrencyConfirmed,
                                );
                              const groupCatalogPriceDeviation = Boolean(
                                groupCatalogService &&
                                !groupItem.catalogReviewConfirmed &&
                                !groupUnitMismatchReason &&
                                normalizePriceUnitForCompare(
                                  groupCatalogService.unit,
                                ) ===
                                  normalizePriceUnitForCompare(
                                    groupItem.unit,
                                  ) &&
                                Number.isFinite(groupCatalogPrice) &&
                                Number.isFinite(groupItemPrice) &&
                                groupCatalogPrice > 0 &&
                                groupItemPrice > 0 &&
                                Math.abs(groupCatalogPrice - groupItemPrice) >=
                                  0.01,
                              );
                              const groupTextFlatOverride = Boolean(
                                groupCatalogService &&
                                !groupItem.catalogReviewConfirmed &&
                                !groupUnitMismatchReason &&
                                normalizePriceUnitForCompare(
                                  groupCatalogService.unit,
                                ) !==
                                  normalizePriceUnitForCompare(
                                    groupItem.unit,
                                  ) &&
                                normalizePriceUnitForCompare(groupItem.unit) ===
                                  "flat" &&
                                groupItemPrice > 0 &&
                                groupItemQuantity === 1,
                              );
                              const groupCatalogMissing = Boolean(
                                itemName.trim() &&
                                !groupItem.catalogReviewConfirmed &&
                                !groupCatalogService,
                              );

                              if (
                                groupItemPrice <= 0 ||
                                groupItemQuantity <= 0
                              ) {
                                addBadge(
                                  "amount",
                                  "Preis/Menge prüfen",
                                  "bg-red-100 text-red-700 ring-1 ring-red-200",
                                  `${itemName || "Leistung"}: Preis oder Menge fehlt/ist unsicher.`,
                                );
                                continue;
                              }
                              if (
                                groupUnitMismatchReason ||
                                groupItem.aiWarning?.trim()
                              ) {
                                addBadge(
                                  "unit",
                                  "Einheit prüfen",
                                  "bg-orange-100 text-orange-800 ring-1 ring-orange-200",
                                  `${itemName || "Leistung"}: Einheit, Menge oder Preis prüfen.`,
                                );
                              }
                              if (groupPriceUnclearReason) {
                                addBadge(
                                  "price_unclear",
                                  "Betrag prüfen",
                                  "bg-red-100 text-red-700 ring-1 ring-red-200",
                                  `${itemName || "Leistung"}: Preis im Text unklar.`,
                                );
                              }
                              if (groupPriceContradictionOpenV17_90L234) {
                                addBadge(
                                  "price_contradiction",
                                  "Preiswiderspruch",
                                  "bg-red-100 text-red-700 ring-1 ring-red-200",
                                  `${itemName || "Leistung"}: Im Kundentext stehen widersprüchliche Gesamt- und Einzelpreisangaben. Bitte kontrollieren und freigeben.`,
                                );
                              }
                              if (
                                (!groupItem.catalogReviewConfirmed &&
                                  groupPriceOverrideReason) ||
                                groupCatalogPriceDeviation ||
                                groupTextFlatOverride
                              ) {
                                addBadge(
                                  "price_deviation",
                                  "Preis abweichend",
                                  "bg-yellow-100 text-yellow-900 ring-1 ring-yellow-300",
                                  formatCatalogReviewTooltip({
                                    title: "Preis weicht vom Katalog ab.",
                                    item: groupItem as any,
                                    catalog: groupCatalogService,
                                    currency,
                                  }),
                                );
                              }
                              // V17.81: Nicht-im-Katalog ist kein eigener Außen-Chip mehr,
                              // wenn Menge/Einheit/Preis aus dem Text klar sind. Der Nutzer
                              // sieht die konkrete Position innen und kann sie bei Bedarf über
                              // das Menü in den Katalog übernehmen.
                            }

                            return combineCatalogReviewBadges(badges);
                          })();
                          const groupBlockerItemsV17_90L174 = groupItems
                            .map((groupItem) => {
                              const reasons: string[] = [];
                              const serviceName = compactText(groupItem.serviceName) || "Leistung";
                              if (isUnresolvedConversionServiceNameV17_90L36b(groupItem.serviceName))
                                reasons.push("Leistung fehlt");
                              if (isUnresolvedConversionUnitV17_90L36b(groupItem.unit))
                                reasons.push("Einheit fehlt");
                              if (Number(groupItem.quantity || 0) <= 0)
                                reasons.push("Menge fehlt");
                              if (Number(groupItem.unitPrice || 0) <= 0)
                                reasons.push("Preis fehlt");
                              return reasons.length > 0
                                ? { serviceName, reasons }
                                : null;
                            })
                            .filter(Boolean) as Array<{
                              serviceName: string;
                              reasons: string[];
                            }>;
                          const groupBlockerTooltipV17_90L174 =
                            groupBlockerItemsV17_90L174
                              .map(
                                (entry) =>
                                  `* ${entry.serviceName} — ${entry.reasons.join(", ")}`,
                              )
                              .join("\n");
                          const siteHasRequiredInfo = site
                            ? hasWorkSiteContent(site)
                            : false;
                          const siteNeedsReview = Boolean(
                            !site || (site && !siteHasRequiredInfo),
                          );
                          const siteHasNoItems = Boolean(
                            site && groupItemCount === 0,
                          );
                          const siteAccentClass = siteNeedsReview
                            ? "border-red-400 bg-red-100/70 text-red-900 hover:bg-red-200/60 dark:border-red-800/70 dark:bg-red-950/25 dark:text-red-100 dark:hover:bg-red-900/30"
                            : siteHasNoItems
                              ? "border-amber-400 bg-amber-100/70 text-amber-900 hover:bg-amber-200/60 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100 dark:hover:bg-amber-900/30"
                              : "border-cyan-400 bg-cyan-100/70 text-slate-900 hover:bg-cyan-200/60 dark:border-cyan-700 dark:bg-cyan-950/25 dark:text-slate-50 dark:hover:bg-cyan-900/30";
                          const itemAccentClass = siteNeedsReview
                            ? "border-l-red-400"
                            : siteHasNoItems
                              ? "border-l-amber-400"
                              : "border-l-slate-300";
                          const groupExpanded = isWorkSiteGroupExpanded(site);
                          const isEditingSite = Boolean(
                            site && editingWorkSiteId === site.id,
                          );

                          if (
                            hasMultipleEditWorkSites &&
                            !isFirstInSite &&
                            !groupExpanded
                          ) {
                            return null;
                          }

                          return (
                            <div
                              key={item.key}
                              className={
                                hasMultipleEditWorkSites ? "space-y-1.5" : ""
                              }
                            >
                              {hasMultipleEditWorkSites && isFirstInSite && site && (
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => {
                                    if (site) setActiveWorkSiteId(site.id);
                                    toggleWorkSiteGroup(site);
                                  }}
                                  onKeyDown={(event) => {
                                    if (
                                      event.key === "Enter" ||
                                      event.key === " "
                                    ) {
                                      event.preventDefault();
                                      if (site) setActiveWorkSiteId(site.id);
                                      toggleWorkSiteGroup(site);
                                    }
                                  }}
                                  className={`cursor-pointer rounded-xl border-2 px-3 py-2 shadow-sm transition-colors ${groupExpanded ? "rounded-b-none border-b-0" : ""} ${
                                    site
                                      ? siteAccentClass
                                      : "border-red-400 bg-red-100/70 text-red-900 hover:bg-red-200/60 dark:border-red-800/70 dark:bg-red-950/25 dark:text-red-100 dark:hover:bg-red-900/30"
                                  } ${isActiveSite ? "ring-2 ring-offset-1 ring-cyan-300" : ""}`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold leading-tight">
                                        <span className="shrink-0 text-base leading-none">
                                          {groupExpanded ? "▾" : "▸"}
                                        </span>
                                        <span>
                                          📍{" "}
                                          {`${siteIndex + 1}. ${formatWorkSiteTitle(site)}`}
                                        </span>
                                        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-slate-700 ring-1 ring-slate-200">
                                          {groupItemCount} Leistung
                                          {groupItemCount === 1 ? "" : "en"}
                                        </span>
                                        {isActiveSite && (
                                          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-cyan-700 ring-1 ring-cyan-200">
                                            aktiv
                                          </span>
                                        )}
                                        {siteNeedsReview && (
                                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200">
                                            Arbeitsort prüfen
                                          </span>
                                        )}
                                        {siteHasNoItems && !siteNeedsReview && (
                                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                                            Keine Leistungen
                                          </span>
                                        )}
                                      </div>
                                      {(groupReviewSummaryV17_90L135G.count > 0 ||
                                        groupBlockerItemsV17_90L174.length > 0) && (
                                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                          {groupReviewSummaryV17_90L135G.count > 0 && (
                                            <span
                                              className="relative inline-flex max-w-[12rem] items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900"
                                              role="button"
                                              tabIndex={0}
                                              onClick={(event) => event.stopPropagation()}
                                              onPointerDown={(event) => event.stopPropagation()}
                                            >
                                              <span className="truncate whitespace-nowrap">
                                                Leistungen prüfen · {groupReviewSummaryV17_90L135G.count}
                                              </span>
                                              <ViewportAwareOrderServiceTooltip
                                                badge={{
                                                  key: `site_service_review_${site?.id || "general"}`,
                                                  label: `Leistungen prüfen · ${groupReviewSummaryV17_90L135G.count}`,
                                                  className:
                                                    "border-amber-300 bg-amber-100 text-amber-900",
                                                  tooltip:
                                                    groupReviewSummaryV17_90L135G.tooltip,
                                                }}
                                                align="left"
                                              />
                                            </span>
                                          )}
                                          {groupBlockerItemsV17_90L174.length > 0 && (
                                            <span
                                              className="relative inline-flex max-w-[12rem] items-center gap-1 rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800"
                                              role="button"
                                              tabIndex={0}
                                              onClick={(event) => event.stopPropagation()}
                                              onPointerDown={(event) => event.stopPropagation()}
                                            >
                                              <AlertTriangle className="h-3 w-3 shrink-0" />
                                              <span className="truncate whitespace-nowrap">
                                                Auftrag prüfen · {groupBlockerItemsV17_90L174.length}
                                              </span>
                                              <ViewportAwareOrderServiceTooltip
                                                badge={{
                                                  key: `site_order_blocker_${site?.id || "general"}`,
                                                  label: `Auftrag prüfen · ${groupBlockerItemsV17_90L174.length}`,
                                                  className:
                                                    "border-red-300 bg-red-100 text-red-800",
                                                  tooltip:
                                                    groupBlockerTooltipV17_90L174,
                                                }}
                                                align="left"
                                              />
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      <div className="mt-0.5 text-xs text-muted-foreground">
                                        {site
                                          ? formatWorkSiteAddress(site) ||
                                            "Adresse prüfen"
                                          : "Arbeitsort und Leistung direkt unten auswählen"}
                                      </div>
                                    </div>
                                    <div className="shrink-0 text-right">
                                      <div className="text-[10px] text-muted-foreground">
                                        Zwischensumme
                                      </div>
                                      <div className="font-mono text-sm font-semibold">
                                        {formatCurrency(
                                          site ? getWorkSiteTotal(site.id) : 0,
                                          currency,
                                        )}
                                      </div>
                                      {site && (
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setActiveWorkSiteId(site.id);
                                            setEditingWorkSiteId((prev) =>
                                              prev === site.id ? null : site.id,
                                            );
                                            if (!groupExpanded) {
                                              setExpandedWorkSiteIds((prev) =>
                                                prev.includes(site.id)
                                                  ? prev
                                                  : [site.id, ...prev],
                                              );
                                            }
                                          }}
                                          className="mt-1 text-xs text-primary hover:underline"
                                        >
                                          {isEditingSite
                                            ? "Arbeitsort schließen"
                                            : "Arbeitsort bearbeiten"}
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {site && isEditingSite && (
                                    <div
                                      data-work-site-editor-id={site.id}
                                      onClick={(event) =>
                                        event.stopPropagation()
                                      }
                                      className="mt-2 rounded-md border bg-background/80 p-2 space-y-2"
                                    >
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {renderOrderExecutionAddressAutocompleteV17_90L291({
                                          inputKey: site.id,
                                          value: site.siteName || "",
                                          onChange: (value) =>
                                            updateFormWorkSite(
                                              site.id,
                                              "siteName",
                                              value,
                                            ),
                                          onSelect: (suggestion) =>
                                            applyPersistentExecutionAddressSuggestionToWorkSiteV17_90L289(
                                              site.id,
                                              suggestion,
                                            ),
                                          label: "Objekt / Bereich",
                                          labelClassName: "text-[10px]",
                                          inputClassName: "h-8 text-xs",
                                          placeholder: "z. B. Haus A, EG rechts",
                                        })}
                                        <div>
                                          <Label className="text-[10px]">
                                            Strasse
                                          </Label>
                                          <Input
                                            className="h-8 text-xs"
                                            value={site.siteAddress || ""}
                                            onChange={(e) =>
                                              updateFormWorkSite(
                                                site.id,
                                                "siteAddress",
                                                e.target.value,
                                              )
                                            }
                                            placeholder="Strasse + Hausnr."
                                          />
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr] gap-2">
                                        <div>
                                          <Label className="text-[10px]">
                                            PLZ
                                          </Label>
                                          <Input
                                            className="h-8 text-xs"
                                            value={site.sitePlz || ""}
                                            onChange={(e) =>
                                              updateFormWorkSite(
                                                site.id,
                                                "sitePlz",
                                                e.target.value,
                                              )
                                            }
                                            placeholder="PLZ"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-[10px]">
                                            Ort
                                          </Label>
                                          <Input
                                            className="h-8 text-xs"
                                            value={site.siteCity || ""}
                                            onChange={(e) =>
                                              updateFormWorkSite(
                                                site.id,
                                                "siteCity",
                                                e.target.value,
                                              )
                                            }
                                            placeholder="Ort"
                                          />
                                        </div>
                                      </div>
                                      <div>
                                        <Label className="text-[10px]">
                                          Hinweis
                                        </Label>
                                        <Input
                                          className="h-8 text-xs"
                                          value={site.siteNote || ""}
                                          onChange={(e) =>
                                            updateFormWorkSite(
                                              site.id,
                                              "siteNote",
                                              e.target.value,
                                            )
                                          }
                                          placeholder="z. B. Eingang hinten, Rampe 2"
                                        />
                                      </div>
                                      {renderCustomerExecutionAddressSaveChoiceV17_90L296(site)}
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="text-[11px] text-muted-foreground">
                                          Zugeordnet: {groupItemCount}{" "}
                                          Leistung(en)
                                        </div>
                                        <div className="flex flex-wrap items-center justify-end gap-2">
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            className="text-red-600 hover:text-red-700"
                                            onClick={() =>
                                              void removeFormWorkSite(site.id)
                                            }
                                          >
                                            Löschen
                                          </Button>
                                          {shouldShowCustomerExecutionAddressSaveCheckboxV17_90L298(site) && (
                                          <label className="inline-flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                                            <input
                                              type="checkbox"
                                              className="h-4 w-4 rounded border-input"
                                              checked={saveExecutionAddressInCustomerProfile}
                                              onChange={(event) =>
                                                setSaveExecutionAddressInCustomerProfile(
                                                  event.target.checked,
                                                )
                                              }
                                            />
                                            Im Kundenprofil speichern
                                          </label>
                                          )}
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() =>
                                              void acceptOrderWorkSiteV17_90L295(
                                                site.id,
                                              )
                                            }
                                            disabled={saving}
                                          >
                                            {saving
                                              ? "Übernehmen..."
                                              : "Ausführungsort übernehmen"}
                                          </Button>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {groupExpanded && isEmptySitePlaceholder ? (
                                <div
                                  className={`ml-2 rounded-lg border-2 border-dashed p-3 text-xs shadow-sm ${
                                    siteNeedsReview
                                      ? "border-red-300 bg-red-50/50 text-red-800 dark:border-red-800 dark:bg-red-950/10 dark:text-red-200"
                                      : "border-amber-300 bg-amber-50/40 text-amber-800 dark:border-amber-800 dark:bg-amber-950/10 dark:text-amber-200"
                                  }`}
                                >
                                  <div className="font-semibold">
                                    {siteNeedsReview
                                      ? "Arbeitsort bitte ausfüllen."
                                      : "Noch keine Leistungen in diesem Arbeitsort."}
                                  </div>
                                  <div className="mt-0.5 text-muted-foreground">
                                    Arbeitsort und zugehörige Leistung vollständig
                                    ausfüllen oder den Arbeitsort löschen.
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {site && !siteNeedsReview && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-xs"
                                        onClick={() =>
                                          addItemToWorkSite(site.id)
                                        }
                                      >
                                        + Leistung hier hinzufügen
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                groupExpanded && (
                                  <details
                                    open={expandedServiceItemKeys.includes(item.key)}
                                    onToggle={(event) => {
                                      const isOpen = event.currentTarget.open;
                                      setExpandedServiceItemKeys((current) =>
                                        isOpen
                                          ? current.includes(item.key)
                                            ? current
                                            : [...current, item.key]
                                          : current.filter((key) => key !== item.key),
                                      );
                                    }}
                                    className={`group/service-item relative min-w-0 border-2 shadow-sm ${
                                      hasMultipleEditWorkSites
                                        ? `${site ? "ml-2" : ""} rounded-xl border-l-4 ${itemAccentClass}`
                                        : "rounded-xl"
                                    } ${
                                      hasCriticalItemReview
                                        ? "border-red-300 bg-red-50/30 dark:border-red-800/70 dark:bg-red-950/10"
                                        : hasAnyItemReview
                                          ? "border-amber-300 bg-amber-50/30 dark:border-amber-800/70 dark:bg-amber-950/10"
                                          : "border-slate-300 bg-slate-50/40 dark:border-slate-700 dark:bg-slate-900/20"
                                    }`}
                                    onClick={() =>
                                      site && setActiveWorkSiteId(site.id)
                                    }
                                  >
                                    <summary
                                      className={`grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-xl px-3 py-2.5 transition-colors [&::-webkit-details-marker]:hidden ${
                                        hasCriticalItemReview
                                          ? "hover:bg-red-100/70 dark:hover:bg-red-900/25"
                                          : hasAnyItemReview
                                            ? "hover:bg-amber-100/70 dark:hover:bg-amber-900/25"
                                            : "hover:bg-slate-100/80 dark:hover:bg-slate-800/60"
                                      }`}
                                    >
                                      <div className="min-w-0">
                                        <div className="min-w-0">
                                          <span className="block truncate text-sm font-semibold text-foreground sm:text-base">
                                            {item.serviceName.trim() ||
                                              (hasMultipleEditWorkSites &&
                                              !item.workSiteId
                                                ? "Ausführungsort und Leistung auswählen"
                                                : "Leistung auswählen")}
                                          </span>
                                        </div>
                                        <div className="mt-0.5 grid min-w-0 grid-cols-1 items-center gap-x-4 gap-y-1 sm:grid-cols-[14rem_minmax(0,12rem)]">
                                          <div className="truncate text-xs text-muted-foreground sm:text-sm">
                                            {itemQuantityUnitSummaryV17_90L243} ×{" "}
                                            {itemPriceNumber > 0
                                              ? formatCurrency(itemPriceNumber, currency)
                                              : "Preis prüfen"}
                                          </div>
                                          {hasAnyItemReview && (
                                            <span className="inline-flex min-w-0 max-w-[12rem] items-center overflow-hidden border-l border-slate-200 pl-3 dark:border-slate-700">
                                              <span
                                                title={itemReviewReasonV17_90L134}
                                                className={`max-w-full truncate whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                                  hasCriticalItemReview
                                                    ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
                                                    : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
                                                }`}
                                              >
                                                {itemReviewReasonV17_90L134}
                                              </span>
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      <div className="shrink-0 text-right">
                                        <div className="font-mono text-sm font-semibold text-foreground whitespace-nowrap sm:text-base">
                                          {formatCurrency(itemTotal, currency)}
                                        </div>
                                      </div>

                                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/service-item:rotate-180" />

                                      {hasCatalogActionMenu ? (
                                        <div
                                          className="relative shrink-0"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                          }}
                                        >
                                          <button
                                            type="button"
                                            onClick={(event) => {
                                              event.preventDefault();
                                              event.stopPropagation();
                                              setServiceActionMenuKey(
                                                isMenuOpen ? null : item.key,
                                              );
                                            }}
                                            className="rounded-md border border-slate-200 bg-background p-1.5 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                            title="Leistungsaktionen"
                                            aria-label="Leistungsaktionen"
                                          >
                                            <MoreVertical className="h-4 w-4" />
                                          </button>
                                          {isMenuOpen && (
                                            <div className="absolute right-0 top-full z-[80] mt-1 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-xl dark:border-slate-700 dark:bg-slate-950">
                                              <button
                                                type="button"
                                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
                                                onClick={(event) => {
                                                  event.preventDefault();
                                                  event.stopPropagation();
                                                  setServiceActionMenuKey(null);
                                                  removeItem(index);
                                                }}
                                              >
                                                <Trash2 className="h-4 w-4" />
                                                Leistung löschen
                                              </button>
                                              <button
                                                type="button"
                                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-900"
                                                onClick={(event) => {
                                                  event.preventDefault();
                                                  event.stopPropagation();
                                                  void saveItemToServices(index);
                                                }}
                                              >
                                                <Plus className="h-4 w-4" />
                                                In Leistungskatalog übernehmen
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            removeItem(index);
                                          }}
                                          className="rounded-md border border-red-200 bg-background p-1.5 text-red-600 hover:bg-red-50"
                                          title="Leistung löschen"
                                          aria-label="Leistung löschen"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                      )}
                                    </summary>

                                    <div className="space-y-3 border-t border-slate-200 bg-background p-3 dark:border-slate-700">
                                      {hasMultipleEditWorkSites && !item.workSiteId && (
                                        <div className="rounded-lg border border-cyan-200 bg-cyan-50/60 p-2">
                                          <Label className="text-xs">Arbeitsort wählen</Label>
                                          <select
                                            className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                            value={item.workSiteId || ""}
                                            onChange={(e: any) => {
                                              const nextWorkSiteId = e?.target?.value ?? "";

                                              updateItem(
                                                index,
                                                "workSiteId",
                                                nextWorkSiteId,
                                              );

                                              const keepItemOpenAfterWorkSiteChange = () => {
                                                if (nextWorkSiteId) {
                                                  setActiveWorkSiteId(nextWorkSiteId);
                                                  setExpandedWorkSiteIds((current) =>
                                                    current.includes(nextWorkSiteId)
                                                      ? current
                                                      : [nextWorkSiteId, ...current],
                                                  );
                                                } else {
                                                  setExpandedWorkSiteIds((current) =>
                                                    current.includes("__unassigned__")
                                                      ? current
                                                      : ["__unassigned__", ...current],
                                                  );
                                                }

                                                setExpandedServiceItemKeys((current) =>
                                                  current.includes(item.key)
                                                    ? current
                                                    : [item.key, ...current],
                                                );
                                              };

                                              keepItemOpenAfterWorkSiteChange();
                                              setMovingItemKey(nextWorkSiteId ? null : item.key);

                                              if (typeof window !== "undefined") {
                                                window.setTimeout(
                                                  keepItemOpenAfterWorkSiteChange,
                                                  0,
                                                );
                                              }
                                            }}
                                          >
                                            <option value="">Arbeitsort wählen</option>
                                            {currentEditWorkSites.map((siteOption) => (
                                              <option key={siteOption.id} value={siteOption.id}>
                                                {getWorkSiteSelectLabel(siteOption)}
                                              </option>
                                            ))}
                                          </select>
                                        </div>
                                      )}
                                      <div className="group min-w-0">
                                        <ServiceCombobox
                                          value={getEditableServiceNameValue(
                                            item.serviceName,
                                          )}
                                          services={services as ServiceOption[]}
                                          onChange={(name, svc) =>
                                            onItemServiceSelect(index, name, svc)
                                          }
                                          onServiceCreated={handleServiceCreated}
                                          currentPrice={item.unitPrice}
                                          currentUnit={item.unit}
                                          showManualHint={false}
                                          saveButtonPlacement="none"
                                        />
                                        {!itemHasInternalReviewServiceName &&
                                          item.serviceName.trim().length > 28 && (
                                          <p className="mt-1 hidden rounded-md border border-slate-200 bg-muted/40 px-2 py-1 text-[11px] leading-snug text-muted-foreground break-words group-focus-within:block">
                                            {item.serviceName.trim()}
                                          </p>
                                        )}
                                      </div>

                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                      <div>
                                        <Label className="text-xs">Einheit</Label>
                                        <select
                                          className={`flex h-9 w-full rounded-md border bg-background px-2 text-sm ${
                                            unitInputCriticalV17_90L243
                                              ? "border-red-400 bg-red-50 dark:bg-red-950/20"
                                              : "border-input"
                                          }`}
                                          value={
                                            unitMissingInTextReason &&
                                            !manualUnitConfirmed &&
                                            normalizeForMatch(item.unit).includes("pruefen")
                                              ? "Einheit prüfen"
                                              : item.unit
                                          }
                                          onChange={(e: any) =>
                                            updateItem(
                                              index,
                                              "unit",
                                              e?.target?.value ?? "Stunde",
                                            )
                                          }
                                        >
                                          {priceTypes.map((pt) => (
                                            <option key={pt} value={pt}>
                                              {pt === "Einheit prüfen"
                                                ? "prüfen"
                                                : pt}
                                            </option>
                                          ))}
                                        </select>
                                      </div>

                                      <div>
                                        <Label className="text-xs">Menge</Label>
                                        <Input
                                          type="number"
                                          step="0.25"
                                          className={`h-9 ${
                                            quantityInputCritical
                                              ? "border-red-400 bg-red-50 dark:bg-red-950/20"
                                              : ""
                                          }`}
                                          value={item.quantity}
                                          placeholder={
                                            quantityInputReview ? "prüfen" : "0"
                                          }
                                          onFocus={(e) =>
                                            e.currentTarget.select()
                                          }
                                          onChange={(e: any) =>
                                            updateItem(
                                              index,
                                              "quantity",
                                              e?.target?.value ?? "",
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
                                          className={`h-9 ${
                                            priceInputCritical
                                              ? "border-red-400 bg-red-50 dark:bg-red-950/20"
                                              : ""
                                          }`}
                                          value={item.unitPrice}
                                          placeholder={
                                            priceInputReview ? "prüfen" : "0"
                                          }
                                          onFocus={(e) =>
                                            e.currentTarget.select()
                                          }
                                          onChange={(e: any) =>
                                            updateItem(
                                              index,
                                              "unitPrice",
                                              e?.target?.value ?? "",
                                            )
                                          }
                                        />
                                      </div>
                                    </div>


                                    {showItemReviewBlock && (
                                      <div
                                        className={`rounded-lg border px-3 py-2 text-xs leading-snug ${
                                          isBlockingItemReview
                                            ? "border-red-300 bg-red-100/70 text-red-900 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200"
                                            : "border-amber-300 bg-amber-100/60 text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200"
                                        }`}
                                      >
                                        <div className="mb-0.5 flex items-center gap-1 font-semibold">
                                          <AlertTriangle className="h-3 w-3 shrink-0" />
                                          {isBlockingItemReview
                                            ? "Vor Angebot/Rechnung prüfen"
                                            : "Manuell prüfen"}
                                        </div>

                                        {isBlockingItemReview ? (
                                          <div className="space-y-1">
                                            <div>{compactBlockingReviewMessageV17_90L242}</div>
                                            {compactBlockingReviewSourceV17_90L242 && (
                                              <div>
                                                Quelle:{" "}
                                                <span className="font-medium">
                                                  {compactBlockingReviewSourceV17_90L242}
                                                </span>
                                              </div>
                                            )}

                                            {isBlockingItemReview && (
                                              <div className="mt-2 flex flex-wrap gap-2">
                                                <button
                                                  type="button"
                                                  disabled={
                                                    saving ||
                                                    !isCompleteItemForCatalogAction
                                                  }
                                                  onClick={() =>
                                                    void confirmCurrentItemReviewV17_90L241(
                                                      index,
                                                    )
                                                  }
                                                  className="inline-flex h-8 items-center rounded-md border border-red-300 bg-white px-3 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200 dark:hover:bg-red-950/40"
                                                >
                                                  Übernehmen
                                                </button>
                                                <button
                                                  type="button"
                                                  disabled={saving}
                                                  onClick={() =>
                                                    void discardCurrentItemReviewV17_90L241(
                                                      index,
                                                    )
                                                  }
                                                  className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/20 dark:text-slate-200 dark:hover:bg-slate-900/40"
                                                >
                                                  Verwerfen
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        ) : (
                                          <div className="space-y-0.5">
                                            {showUnitConflict && (
                                              <div className="space-y-0.5">
                                                {manualReviewConfirmedV17_90L241 ? (
                                                  <>
                                                    <div className="font-semibold">
                                                      Angaben bestätigt
                                                    </div>
                                                    <div>
                                                      Die aktuell sichtbaren Werte wurden bewusst übernommen.
                                                    </div>
                                                  </>
                                                ) : manualUnitConfirmed ? (
                                                  <>
                                                    <div className="font-semibold">
                                                      Einheit ergänzt
                                                    </div>
                                                    <div>
                                                      Manuell eingetragen:{" "}
                                                      <span className="font-medium">
                                                        {formatReviewUnitLabel(item.unit)}
                                                      </span>
                                                    </div>
                                                    <div>
                                                      Bitte prüfen, ob diese Einheit zur Leistung passt.
                                                    </div>
                                                  </>
                                                ) : (
                                                  <>
                                                    <div>
                                                      Text:{" "}
                                                      <span className="font-medium">
                                                        {orderSummary}
                                                      </span>
                                                    </div>
                                                    {catalogSummary && (
                                                      <div>
                                                        Katalog:{" "}
                                                        <span className="font-medium">
                                                          {catalogSummary}
                                                        </span>
                                                      </div>
                                                    )}
                                                    <div>
                                                      Einheit prüfen:{" "}
                                                      {item.serviceName || "Leistung"}
                                                    </div>
                                                  </>
                                                )}
                                              </div>
                                            )}

                                            {!showUnitConflict &&
                                              showPriceOverride &&
                                              catalogService && (
                                                <div className="space-y-0.5">
                                                  {hasFrontendCatalogUnitDeviation ? (
                                                    <>
                                                      <div>
                                                        Einheit manuell eingetragen oder vom Katalog abweichend.
                                                      </div>
                                                      <div>
                                                        Auftrag: {unitShortLabel(item.unit)} · {formatCurrency(itemPriceNumber, currency)}
                                                      </div>
                                                    </>
                                                  ) : (
                                                    <>
                                                      <div className="font-semibold">
                                                        Textpreis übernommen
                                                      </div>
                                                      <div>
                                                        Textpreis:{" "}
                                                        <span className="font-medium">
                                                          {formatCurrency(itemPriceNumber, currency)} / {unitShortLabel(item.unit)}
                                                        </span>
                                                      </div>
                                                    </>
                                                  )}
                                                  <div className="text-amber-700/75 dark:text-amber-200/75">
                                                    Katalogpreis:{" "}
                                                    <span className="font-medium">
                                                      {formatCurrency(catalogPrice, currency)} / {unitShortLabel(catalogService.unit)}
                                                    </span>
                                                  </div>
                                                </div>
                                              )}

                                            {!showUnitConflict &&
                                              !showPriceOverride &&
                                              showManualCurrencyConfirmedReview && (
                                                <div className="space-y-0.5">
                                                  <div>
                                                    {priceContradictionReasonV17_90L234
                                                      ? "Preis manuell bestätigt."
                                                      : "Preis/Währung manuell bestätigt."}
                                                  </div>
                                                  {sourceLineForItem && (
                                                    <div>
                                                      Ausgangstext:{" "}
                                                      <span className="font-medium">
                                                        {sourceLineForItem}
                                                      </span>
                                                    </div>
                                                  )}
                                                </div>
                                              )}

                                            {!showUnitConflict &&
                                              showPriceReferenceReview && (
                                                <div>Preis im Text unklar.</div>
                                              )}

                                            {showManualServiceReview && (
                                              <div>
                                                Nicht im Leistungskatalog. Optional über Menü übernehmen.
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    </div>
                                  </details>
                                )
                              )}
                            </div>
                          );
                        },
                      )}
                    </div>
                  </div>

                  <div className="space-y-4 border-t-4 border-slate-300 pt-4">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-base font-semibold">
                        Auftragsdaten & Betrag
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        Klar getrennt von den Leistungen
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <Label>Auftragsdatum</Label>
                        <Input
                          type="date"
                          value={form.date}
                          onChange={(e: any) =>
                            setForm({ ...form, date: e?.target?.value ?? "" })
                          }
                        />
                      </div>

                      <div>
                        <Label>Status</Label>
                        <select
                          className="flex w-full rounded-md border border-input px-3 py-2 text-sm"
                          style={getStatusStyle(ORDER_STATUS_STYLES, form.status)}
                          value={form.status}
                          onChange={(e: any) =>
                            setForm({
                              ...form,
                              status: e?.target?.value ?? "Offen",
                            })
                          }
                        >
                          {orderStatuses.map((status) => (
                            <option
                              key={status}
                              style={getStatusStyle(ORDER_STATUS_STYLES, status)}
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
                          onChange={(e: any) =>
                            setCurrency(
                              e?.target?.value === "EUR" ? "EUR" : "CHF",
                            )
                          }
                        >
                          <option value="CHF">CHF</option>
                          <option value="EUR">EUR</option>
                        </select>
                      </div>
                    </div>

                    <div className="min-w-0 space-y-3 rounded-xl border-2 border-slate-400 bg-slate-100/90 p-2 sm:p-4 dark:border-slate-700 dark:bg-slate-900/70">
                      <MwStControl
                        vatRate={orderVatRate}
                        onChange={setOrderVatRate}
                      />
                      <div className="min-w-0 space-y-1 border-t border-slate-300 pt-2 text-xs sm:text-sm">
                        <div className="flex min-w-0 justify-between">
                          <span className="shrink-0">Netto</span>
                          <span className="font-mono">
                            {formatCurrency(itemsTotal, currency)}
                          </span>
                        </div>
                        {orderVatRate > 0 && (
                          <div className="flex min-w-0 justify-between">
                            <span className="shrink-0">
                              MwSt. {orderVatRate}%
                            </span>
                            <span className="font-mono">
                              {formatCurrency(
                                (itemsTotal * orderVatRate) / 100,
                                currency,
                              )}
                            </span>
                          </div>
                        )}
                        <div className="flex min-w-0 justify-between border-t-2 border-slate-300 pt-2 text-sm font-bold sm:text-base">
                          <span className="shrink-0">Total</span>
                          <span className="font-mono text-primary">
                            {formatCurrency(totalWithVat, currency)}
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

                        <div className="order-1 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:order-2 lg:min-w-[760px] xl:grid-cols-4">
                          <Button
                            type="button"
                            onClick={() => save()}
                            disabled={saving}
                            className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                          >
                            {saving ? "Speichere..." : "Speichern"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={saveAndClose}
                            disabled={saving}
                            className="w-full border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          >
                            Speichern & schließen
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={saveAndCreateOffer}
                            disabled={saving}
                            className="w-full border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                          >
                            <FileCheck className="mr-1.5 h-4 w-4" />
                            Angebot erstellen
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={saveAndCreateInvoice}
                            disabled={saving}
                            className="w-full border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          >
                            <FileText className="mr-1.5 h-4 w-4" />
                            Rechnung erstellen
                          </Button>
                        </div>
                      </div>
                    </div>

                  {/* Besonderheiten — always visible, important warnings highlighted */}
                  <div
                    ref={specialNotesRef}
                    tabIndex={-1}
                    className="scroll-mt-24 space-y-2 outline-none focus:ring-2 focus:ring-amber-300/60"
                  >
                    <div className="flex items-center gap-2">
                      <Label className="font-semibold">Besonderheiten</Label>
                      {dangerNoteLines.length > 0 && (
                        <Badge className="bg-red-100 text-red-700 border border-red-300">
                          Gefahr / Achtung
                        </Badge>
                      )}
                    </div>

                    {compactPrimaryInfoLines.length > 0 && (
                      <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-3 text-sm text-blue-900 space-y-1.5">
                        <div className="font-semibold flex items-center gap-2"><Info className="w-4 h-4" /> Wichtige Informationen</div>
                        {compactPrimaryInfoLines.map((line, index) => {
                          const [label, ...valueParts] = line.split(/:\s+/);
                          const value = valueParts.join(": ").trim();
                          return (
                            <div key={`${line}-${index}`} className="grid grid-cols-[auto_1fr] gap-x-2 break-words">
                              <span className="font-semibold">{value ? `${label}:` : "•"}</span>
                              <span>{value || line}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {dangerNoteLines.length > 0 && (
                      <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 space-y-1">
                        <div className="font-semibold flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          Wichtige Gefahren / Warnhinweise
                        </div>
                        <ul className="list-disc pl-5">
                          {dangerNoteLines.map((line, index) => (
                            <li key={`${line}-${index}`}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <textarea
                      className="w-full resize-none overflow-hidden rounded-md border border-yellow-300 bg-yellow-50/40 px-3 py-2 text-sm leading-7 text-slate-900 outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-200 dark:border-yellow-800/70 dark:bg-yellow-950/15 dark:text-slate-100"
                      rows={Math.max(
                        4,
                        normalSpecialNotesText
                          .split(/\n/g)
                          .reduce(
                            (sum, line) =>
                              sum + Math.max(1, Math.ceil(line.length / 70)),
                            0,
                          ),
                      )}
                      style={
                        { fieldSizing: "content", overflow: "hidden" } as any
                      }
                      value={normalSpecialNotesText}
                      onChange={(e) => updateNormalSpecialNotes(e.target.value)}
                    />
                  </div>

                  {/* Leistungsübersicht — live from the editable items above */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <Label className="font-semibold">
                          Leistungsübersicht
                        </Label>
                        <div className="text-xs text-muted-foreground">
                          Live aus den Leistungen oben
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() =>
                          setServiceOverviewExpanded((prev) => !prev)
                        }
                      >
                        {serviceOverviewExpanded ? "Einklappen" : "Anzeigen"}
                      </Button>
                    </div>

                    {!serviceOverviewExpanded ? (
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-left text-sm hover:bg-muted/40"
                        onClick={() => setServiceOverviewExpanded(true)}
                      >
                        <span className="min-w-0 truncate text-muted-foreground">
                          {hasMultipleEditWorkSites
                            ? `${liveOverviewGroups.length} Arbeitsort${
                                liveOverviewGroups.length === 1 ? "" : "e"
                              } · ${liveOverviewRows.length} Leistung${
                                liveOverviewRows.length === 1 ? "" : "en"
                              }`
                            : `${liveOverviewRows.length} Leistung${
                                liveOverviewRows.length === 1 ? "" : "en"
                              }`}
                        </span>
                        <span className="shrink-0 font-mono font-semibold text-primary">
                          {formatCurrency(itemsTotal, currency)}
                        </span>
                      </button>
                    ) : hasMultipleEditWorkSites ? (
                      <div className="space-y-2 rounded-lg border-2 border-slate-300 bg-muted/20 p-2 dark:border-slate-700">
                        {liveOverviewGroups.length === 0 ? (
                          <div className="rounded-md border bg-background p-3 text-center text-sm text-muted-foreground">
                            Keine Leistung erfasst.
                          </div>
                        ) : (
                          liveOverviewGroups.map((group) => {
                            const groupTotal = group.rows.reduce(
                              (sum, row) => sum + row.sum,
                              0,
                            );

                            return (
                              <div
                                key={group.key}
                                className="overflow-hidden rounded-md border-2 border-slate-300 bg-background shadow-sm dark:border-slate-700"
                              >
                                <div className="flex items-start justify-between gap-2 border-b-2 border-slate-200 bg-muted/40 px-2 py-1.5 dark:border-slate-700">
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold leading-tight">
                                      📍 {group.title}
                                    </div>
                                    {group.address && (
                                      <div className="text-xs text-muted-foreground">
                                        {group.address}
                                      </div>
                                    )}
                                  </div>
                                  <div className="shrink-0 rounded-md border border-slate-300 bg-background px-2 py-1 text-right font-mono text-sm font-bold text-primary dark:border-slate-700">
                                    {formatCurrency(groupTotal, currency)}
                                  </div>
                                </div>
                                <div className="divide-y divide-slate-200 px-2 text-sm dark:divide-slate-700">
                                  {group.rows.map((row) => (
                                    <div
                                      key={`${group.key}-${row.index}-${row.serviceName}`}
                                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 py-1.5"
                                    >
                                      <div className="min-w-0">
                                        <div className="font-medium">
                                          {row.serviceName}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                          {row.hasQuantity
                                            ? `${row.quantity} ${row.unitLabel}`
                                            : "Menge prüfen"}
                                          {" · "}
                                          {row.hasPrice
                                            ? formatCurrency(
                                                row.unitPrice,
                                                currency,
                                              )
                                            : "Preis prüfen"}
                                        </div>
                                      </div>
                                      <div className="text-right font-mono text-sm font-medium">
                                        {formatCurrency(row.sum, currency)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })
                        )}
                        <div className="flex justify-between rounded-md border border-slate-300 bg-muted/70 px-3 py-2 text-sm font-semibold dark:border-slate-700">
                          <span>Gesamt netto</span>
                          <span className="font-mono text-primary">
                            {formatCurrency(itemsTotal, currency)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border-2 border-slate-300 overflow-x-auto dark:border-slate-700">
                        <table className="w-full text-[13px] leading-snug">
                          <thead className="bg-muted/60">
                            <tr className="text-left">
                              <th className="px-2 py-1.5 font-medium w-10">
                                Nr.
                              </th>
                              <th className="px-2 py-1.5 font-medium">
                                Leistung
                              </th>
                              <th className="px-2 py-1.5 font-medium">Einheit</th>
                              <th className="px-2 py-1.5 font-medium text-right">
                                Menge
                              </th>
                              <th className="px-2 py-1.5 font-medium text-right">
                                Einzelpreis
                              </th>
                              <th className="px-2 py-1.5 font-medium text-right">
                                Summe
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {liveOverviewRows.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={6}
                                  className="px-2 py-3 text-center text-muted-foreground"
                                >
                                  Keine Leistung erfasst.
                                </td>
                              </tr>
                            ) : (
                              liveOverviewRows.map((row) => (
                                <tr
                                  key={`${row.index}-${row.serviceName}`}
                                  className="border-t"
                                >
                                  <td className="px-2 py-1.5">{row.index}</td>
                                  <td className="px-2 py-1.5 font-medium">
                                    {row.serviceName}
                                  </td>
                                  <td className="px-2 py-1.5">{row.unitLabel}</td>
                                  <td className="px-2 py-1.5 text-right">
                                    {row.hasQuantity
                                      ? row.quantity
                                      : "Menge prüfen"}
                                  </td>
                                  <td className="px-2 py-1.5 text-right">
                                    {row.hasPrice ? (
                                      formatCurrency(row.unitPrice, currency)
                                    ) : (
                                      <span className="text-red-700 font-medium">
                                        Preis prüfen
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-medium">
                                    {formatCurrency(row.sum, currency)}
                                  </td>
                                </tr>
                              ))
                            )}
                            <tr className="border-t-2 bg-muted/40 font-semibold">
                              <td className="px-2 py-1.5" colSpan={5}>
                                Gesamt
                              </td>
                              <td className="px-2 py-1.5 text-right text-primary">
                                {formatCurrency(itemsTotal, currency)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Kundennachrichten — offen bei Einzelauftrag, kompakt bei Zusammenführung */}
                  <div className="space-y-2 mb-20 md:mb-0">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="font-semibold">Kundennachrichten</Label>
                      {shouldCollapseCustomerMessages && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() =>
                            setCustomerMessagesExpanded((prev) => !prev)
                          }
                        >
                          {customerMessagesExpanded
                            ? "Nachrichten einklappen"
                            : "Nachrichten anzeigen"}
                        </Button>
                      )}
                    </div>

                    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                      {!customerMessagesVisible ? (
                        <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                          <span>
                            {visibleCustomerMessageText
                              ? `${visibleCustomerMessageText.length.toLocaleString("de-CH")} Zeichen Kundentext vorhanden`
                              : currentEditOrder?.audioTranscript
                                ? "Transkription vorhanden"
                                : currentEditOrder?.mediaUrl
                                  ? "Mediendatei vorhanden"
                                  : "Keine Kundennachricht gespeichert"}
                          </span>
                          <span>
                            Zusammenführung: bei Bedarf Original öffnen und
                            prüfen.
                          </span>
                        </div>
                      ) : currentEditOrder ? (
                        <CommunicationBlock
                          data={currentEditOrder as any}
                          showChips={false}
                          showSpecialNotes={false}
                          showCustomerMessage
                        />
                      ) : (
                        <div className="rounded-md border bg-background p-2 text-sm text-muted-foreground">
                          Keine Kundennachricht gespeichert.
                        </div>
                      )}
                    </div>
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
                      // "Diesen Kunden übernehmen" — full customer replacement:
                      // 1. Persist customerId change on the order via API
                      // 2. Update local form + customer display
                      // 3. Cleanup: soft-delete old customer if it has no more active docs
                      // 4. Show toast + close panel
                      if (!editId) return;
                      const oldCustomerId = form.customerId; // capture before overwrite
                      const res = await fetch(`/api/orders/${editId}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ customerId: match.id }),
                      });
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        toast.error(err?.error || "Fehler beim Kunden-Wechsel");
                        return;
                      }
                      // Update local form state
                      setForm((f: any) => ({ ...f, customerId: match.id }));
                      // Update newCust with the selected customer's full data
                      setNewCust({
                        name: (match.name ?? "") as string,
                        address: (match.address ?? "") as string,
                        plz: (match.plz ?? "") as string,
                        city: (match.city ?? "") as string,
                        phone: (match.phone ?? "") as string,
                        email: (match.email ?? "") as string,
                        country: "CH",
                      });
                      // Ensure selected customer exists in local customers list
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
                      // Update nested customer in orders list
                      setOrders((prev: Order[]) =>
                        prev.map((o) =>
                          o.id === editId
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
                      // Close customer editor + dup panel
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
                      // After merge the backend may have kept the OTHER record
                      // (lower customerNumber wins). Rebind form.customerId to the
                      // surviving record BEFORE reloading the list so the edit
                      // dialog keeps showing a valid customer.
                      setForm((f: any) => ({
                        ...f,
                        customerId: r.survivingCustomerId,
                      }));
                      // Stage F – Critical bug fix:
                      // The merge persists user-selected values to the surviving
                      // record. We MUST replace local `newCust` form state with
                      // those values, otherwise the visible "Kunde bearbeiten"
                      // form keeps showing stale pre-merge values and a
                      // subsequent "Kunde aktualisieren" wipes the merge.
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
                        // Reflect in customers list so dbCust diff in saveCustomer
                        // matches the new state and fieldsToClear stays empty.
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
                        // Reflect in nested customer in orders list
                        setOrders((prev) =>
                          prev.map((o: any) =>
                            o.customerId === m.id
                              ? { ...o, customer: { ...o.customer, ...m } }
                              : o,
                          ),
                        );
                        // Keep customer editor open so user can verify values.
                        setEditingCustomer(true);
                        setShowNewCustomer(true);
                      }
                      // Background reload to refresh aggregations / nested data.
                      await load();
                    }}
                  />
                );
              })()}
          </div>
          {/* The edit dialog keeps its existing document actions.
              List navigation is handled by the fixed process button. */}
        </DialogContent>
      </Dialog>

      {/* Catalog decision dialog */}
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
                  {catalogDecision.existing.name} existiert bereits im
                  Leistungskatalog.
                </div>
                <div className="mt-1">
                  Wähle bewusst, ob nur dieser Auftrag geprüft werden soll oder
                  ob der Standardpreis im Katalog global geändert wird.
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-muted-foreground font-medium">
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
                  <div className="text-muted-foreground font-medium">
                    Dieser Auftrag
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
                  onClick={resolveCatalogDecisionForCurrentOrder}
                >
                  Nur diesen Auftrag als geprüft übernehmen
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={catalogDecisionSaving}
                  onClick={updateCatalogPriceFromDecision}
                >
                  {catalogDecisionSaving ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Aktualisiere ...
                    </span>
                  ) : (
                    "Katalogpreis global aktualisieren"
                  )}
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

      {/* Archive confirmation dialog */}
      <Dialog
        open={!!archiveId}
        onOpenChange={(open) => {
          if (!open) setArchiveId(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>In Papierkorb verschieben?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Der Auftrag wird in den Papierkorb verschoben und kann dort
            wiederhergestellt werden. Wenn der Auftrag nur an einem leeren
            Dummy-Kunden hängt, wird dieser automatisch mit entfernt.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setArchiveId(null)}
            >
              Abbrechen
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmArchive}>
              In Papierkorb
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
