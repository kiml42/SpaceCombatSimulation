using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting
{
    public class PotentialTarget
    {
        private float _projectileSpeed;
        private float _extraOffsetScaler = 1f;

        public PotentialTarget()
        {

        }
        
        public PotentialTarget(Transform target, float projectileSpeed)
        {
            Target = target;
            _projectileSpeed = projectileSpeed;
        }

        public Vector3 LocationInAimedSpace(Rigidbody aimingObject, bool correctForVelocity = true)
        {
            var location = correctForVelocity ? CorrectForVelocity(aimingObject) : Target.transform.position;
            
            return aimingObject == null ? Vector3.zero: aimingObject.transform.InverseTransformPoint(location);
        }
        
        public float Score { get; set; }
        public Transform Target { get; set; }
        
        public Vector3 CorrectForVelocity(Rigidbody baseObject)
        {
            var location = Target.position;

            if(_projectileSpeed == 0)
            {
                return location;
            }

            var rigidBody = Target.GetComponent("Rigidbody") as Rigidbody;

            if(rigidBody == null)
            {
                return location;
            }

            var velocity = rigidBody.velocity;

            var distance = DistanceToTurret(baseObject, false);
            
            velocity = baseObject == null ? velocity : velocity - baseObject.velocity;

            var offsetdistance =  _extraOffsetScaler * distance * velocity / _projectileSpeed;

            //Debug.Log("s=" + distance + "v=" + velocity + ", vp=" + _projectileSpeed + ", aiming " + offsetdistance + " ahead.");

            return location + offsetdistance;
        }

        public float DistanceToTurret(Rigidbody thisTurret, bool correctForVelocity = true)
        {
            var location = correctForVelocity ? CorrectForVelocity(thisTurret) : Target.position;
            var dist = Vector3.Distance(location, thisTurret.transform.position);
            return dist;
        }

        public Vector3 LocationInOtherTransformSpace(Rigidbody otherTransform, bool correctForVelocity = true)
        {
            var location = correctForVelocity ? CorrectForVelocity(otherTransform) : Target.transform.position;

            return otherTransform.transform.InverseTransformPoint(location);
        }
    }
}
