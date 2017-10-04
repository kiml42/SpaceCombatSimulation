using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class RayTrigger : MonoBehaviour, IFireControl
{
    private TargetChoosingMechanism _targetChoosingMechanism;
    public Transform AimingObject;
    private IFireControl _fireControl;
    public float MaxDistance = 100000;
    public float MinDistance = 0;

    [Tooltip("Shoot anything with an enemy tag, even if it's not the target being aimed at." +
        " Alternatively only shoot if aimed at the actual target.")]
    public bool ShootAnyEnemy = true;

    // Use this for initialization
    void Start()
    {
        _targetChoosingMechanism = GetComponent("TargetChoosingMechanism") as TargetChoosingMechanism;
    }

    public bool ShouldShoot(Target target)
    {
        RaycastHit hit;
        var ray = new Ray(AimingObject.position + (AimingObject.forward * MinDistance), AimingObject.forward);
        if (Physics.Raycast(ray, out hit, MaxDistance, -1, QueryTriggerInteraction.Ignore))
        {
            //is a hit
            if (ShootAnyEnemy)
            {
                var tags = _targetChoosingMechanism.GetEnemyTags();
                return tags.Contains(hit.transform.tag);
            }

            return hit.transform == target.Transform;
        }
        return false;
    }

    public bool ShouldShoot()
    {
        return ShouldShoot(_targetChoosingMechanism.CurrentTarget);
    }
}
