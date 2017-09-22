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
    public class PotentialTarget
    {
        public float Score { get; set; }
        private Target _target;

        public Transform TargetTransform { get
            {
               return _target.Transform;
            }
        }
        public Rigidbody TargetRigidbody { get
            {
                return _target.Rigidbody;
            }
        }

        public PotentialTarget()
        {

        }
        
        public PotentialTarget(Rigidbody target)
        {
            _target = new Target(target);
        }

        public PotentialTarget(Transform target)
        {
            _target = new Target(target);
        }

        public PotentialTarget(Target target)
        {
            _target = target;
        }
    }
}
