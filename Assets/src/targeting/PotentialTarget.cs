using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting
{
    /// <summary>
    /// Class for keeping a score for a potential target
    /// </summary>
    public class PotentialTarget : Target
    {
        public float Score { get; set; }
        public bool IsValidForCurrentPicker { get; set; }
                
        public PotentialTarget(Rigidbody target) : base (target)
        {
        }

        public PotentialTarget(Transform target) : base(target)
        {
        }

        public PotentialTarget(Target target) : base(target)
        {

        }
    }
}
