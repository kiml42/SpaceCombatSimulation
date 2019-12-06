using System;
using Assets.Src.Interfaces;
using UnityEngine;
using System.Linq;
using Assets.Src.ObjectManagement;
using Assets.Src.Turret;

namespace Assets.Src.Targeting
{
    [Obsolete ("ProximityApproachDetonator does a better job")]
    public class ProximityDetonator : IDetonator
    {
        private readonly Rigidbody _exploderRigidbody;
        private readonly float _detonationDistance;

        private IExploder _exploder;
        
        public ProximityDetonator(IExploder exploder, Rigidbody exploderRigidBody, float detonationDistance)
        {
            _exploderRigidbody = exploderRigidBody;
            _detonationDistance = detonationDistance;
            _exploder = exploder;
        }

        public void AutoDetonate(ITarget target)
        {
            if (ShouldDetonate(target))
            {
                Debug.Log(_exploderRigidbody + " is auto-detonating - proximity detonator");
                DetonateNow();
            }
        }

        private bool ShouldDetonate(ITarget target)
        {
            if(target == null)
            {
                return false;
            }
            var distance = target.DistanceToTurret(_exploderRigidbody, _exploderRigidbody.velocity.magnitude);
            Debug.Log("target = " + target.Transform + ", distance = " + distance + ", should detonate = " + (distance <= _detonationDistance));
            return distance <= _detonationDistance;
        }

        public void DetonateNow()
        {
            _exploder.ExplodeNow();
        }
    }
}