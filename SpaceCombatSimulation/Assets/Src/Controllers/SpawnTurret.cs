using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System.Collections.Generic;
using UnityEngine;

public class SpawnTurret : MonoBehaviour
{
    public IKnowsEnemyTags EnemyTagSource;

    [Tooltip("if true, the turret will be tagged with the parent objects tag. This object's tag is used if there is no parent.")]
    public bool TagChildren = true;

    public ITarget ParentForTurret;
    
    [Tooltip("only used if the turret won't be able to find a deffered tag source.")]
    public List<string> EnemyTags;

    public Transform TurretPrefab;

	// Use this for initialization
	void Start () {
        if(TurretPrefab != null)
        {
            if(EnemyTagSource == null && transform.parent != null)
            {
                EnemyTagSource = transform.GetComponentInParent<IKnowsEnemyTags>();
            }

            if(EnemyTagSource != null)
            {
                EnemyTags = EnemyTagSource.KnownEnemyTags;
            }

            if (ParentForTurret == null )
            {
                Debug.LogWarning($"{name} has no parent set for its turrets...");
                ParentForTurret = transform.GetComponent<ITarget>();
            }
            if (ParentForTurret == null && transform.parent != null)
            {
                Debug.LogWarning($"...and it couldn't find one in itself...");
                ParentForTurret = transform.GetComponentInParent<ITarget>();
            }
            if (ParentForTurret == null)
            {
                Debug.LogError($"...or it's parent - it doesn't have one at all!");
            }

            var turret = Instantiate(TurretPrefab, transform.position, transform.rotation, ParentForTurret.Transform);

            if(ParentForTurret != null)
            {
                var parentRigidbody = ParentForTurret.Rigidbody;
                if(parentRigidbody != null)
                {
                    turret.SetVelocity(parentRigidbody.velocity);
                }

                turret.parent = ParentForTurret.Transform;
                turret.GetComponent<FixedJoint>().connectedBody = parentRigidbody;

                var renderer = ParentForTurret.Transform.GetComponentInChildren<Renderer>();

                if (renderer != null)
                {
                    //Debug.Log("has renderer");
                    turret.transform.SetColor(renderer.material.color);
                }
            }

            var tagKnower = turret.GetComponent<IKnowsEnemyTags>();
            if(tagKnower != null)
            {
                tagKnower.KnownEnemyTags = EnemyTags;
            }

            if (TagChildren)
            {
                turret.GetComponent<ITarget>().Team = ParentForTurret != null ? ParentForTurret.Team : GetComponent<ITarget>().Team;
            }
        
            Destroy(gameObject);
        } else
        {
            Debug.LogWarning(name + " Has no turret to spawn.");
        }
    }
}
