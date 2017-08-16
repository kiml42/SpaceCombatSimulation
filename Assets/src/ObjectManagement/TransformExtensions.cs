using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.ObjectManagement
{
    public static class TransformExtensions
    {
        public static bool IsInvlaid(this Transform transform)
        {
            return transform == null || transform.gameObject == null;
        }

        public static bool IsValid(this Transform transform)
        {
            return !IsInvlaid(transform);
        }
    }
}
