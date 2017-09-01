using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting
{
    /// <summary>
    /// Class for keeping a score for a potential target rigidbody
    /// </summary>
    public class PotentialTarget
    {
        public float Score { get; set; }
        public Transform TargetTransform { get; set; }
        public Rigidbody TargetRigidbody { get; set; }

        public PotentialTarget()
        {

        }
        
        public PotentialTarget(Rigidbody target)
        {
            TargetRigidbody = target;
            TargetTransform = target.transform;
        }

        public PotentialTarget(Transform target)
        {
            TargetTransform = target;
            TargetRigidbody = target.GetComponent("Rigidbody") as Rigidbody;
        }
    }
}
